import {
	BadGatewayException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
} from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { customers } from "../database/schemas/customers.js";
import { orders } from "../database/schemas/orders.js";
import { payments } from "../database/schemas/payments.js";
import type { OrderId, PaymentId, UserId } from "../domain/ids.js";
import { Money } from "../domain/money.js";
import { invalid } from "../http/request-body.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type { PaymentDto } from "./payment.dto.js";
import { PaymentAccounts } from "./payment-accounts.js";
import {
	type ChargeInput,
	type GatewayCharge,
	GatewayRefusal,
	PAYMENT_GATEWAY,
	type PaymentGateway,
	type PaymentMethod,
} from "./payment-gateway.js";
import { dueDate, type PaymentRequest } from "./payment-input.js";
import { PAYMENT_SETTINGS, type PaymentSettings } from "./payment-settings.js";
import {
	failPayment,
	recordPaymentEvent,
	settlePayment,
} from "./settle-payment.js";

const logger = new Logger("Payments");

/** Days the buyer has to pay, by method: a boleto takes time to reach a bank. */
const DAYS_TO_PAY: Record<PaymentMethod, number> = {
	pix: 0,
	boleto: 3,
	card: 0,
};

const selectPayments = (tx: TenantTransaction) =>
	tx
		.select({
			id: payments.id,
			method: payments.method,
			status: payments.status,
			amount: payments.amount,
			refunded: payments.refunded,
			failure: payments.failure,
			dueDate: payments.dueDate,
			details: payments.details,
			createdAt: payments.createdAt,
		})
		.from(payments)
		.$dynamic();

const toDto = ({
	details,
	...payment
}: Awaited<ReturnType<typeof selectPayments>>[number]): PaymentDto => ({
	...payment,
	...details,
});

/** A payment as the store and the panel see it. */
export async function paymentView(
	tx: TenantTransaction,
	id: PaymentId,
): Promise<PaymentDto> {
	const [payment] = await selectPayments(tx).where(eq(payments.id, id));
	return toDto(payment);
}

/** The order's payments, newest first. */
export async function orderPayments(
	tx: TenantTransaction,
	orderId: OrderId,
): Promise<PaymentDto[]> {
	const rows = await selectPayments(tx)
		.where(eq(payments.orderId, orderId))
		.orderBy(desc(payments.createdAt), desc(payments.id));
	return rows.map(toDto);
}

/**
 * Charges orders at the gateway, in the store's account. "Charge" lives
 * here; marking the order paid is settlePayment's, run for whatever the
 * gateway answers.
 */
@Injectable()
export class Payments {
	constructor(
		private readonly tenantDb: TenantDatabase,
		private readonly accounts: PaymentAccounts,
		@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
		@Inject(PAYMENT_SETTINGS) private readonly settings: PaymentSettings,
	) {}

	/**
	 * Charges the order behind the cart token for its total. The payment is
	 * recorded first, so an order has one under way at a time (409); the
	 * gateway is called outside any transaction. A refusal (a declined card)
	 * answers the payment as failed, and the buyer may pay again; a gateway
	 * that does not answer is 502, and the payment stays pending for the
	 * reconciliation to check. undefined when the store has no such order.
	 * Paying again by the method of the payment under way or done answers
	 * that payment, without charging again.
	 */
	async pay(
		tokenHash: string,
		request: PaymentRequest,
		remoteIp: string,
	): Promise<PaymentDto | undefined> {
		const started = await this.tenantDb.run((tx) =>
			this.start(tx, tokenHash, request, remoteIp),
		);
		if (!started) {
			return undefined;
		}
		if (started.existing) {
			return this.tenantDb.run((tx) => paymentView(tx, started.id));
		}
		const { id, credential, input } = started;
		let charge: GatewayCharge;
		try {
			charge = await this.gateway.charge(credential, input);
		} catch (error) {
			if (error instanceof GatewayRefusal) {
				return this.tenantDb.run(async (tx) => {
					await failPayment(tx, id, error.message);
					return paymentView(tx, id);
				});
			}
			// Never the input: it may carry the card.
			logger.error(
				`Charging payment ${id} failed: ${(error as Error).message}`,
			);
			throw new BadGatewayException(
				"The payment gateway did not answer; the payment will be checked",
			);
		}
		return this.tenantDb.run(async (tx) => {
			await settlePayment(tx, id, charge);
			return paymentView(tx, id);
		});
	}

	/** The order's payments, newest first; undefined when the store has no such order. */
	forOrder(orderId: OrderId): Promise<PaymentDto[] | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(eq(orders.id, orderId));
			return order && orderPayments(tx, orderId);
		});
	}

	/**
	 * Gives `amount` of the order's confirmed payment back to the buyer, or
	 * all that is left of it (null). 409 without a confirmed payment, or
	 * when the gateway refuses (its message); 400 past what is left; 502
	 * when the gateway fails. The order's state does not change: cancelling
	 * is the staff's own step. undefined when the store has no such order.
	 *
	 * ponytail: the gateway is called inside the transaction that locks the
	 * payment, so two refunds never pass the same check. A commit that fails
	 * after the call leaves a refund the gateway made and we did not record;
	 * its notification of a full refund still settles it.
	 */
	refund(
		orderId: OrderId,
		amount: Money | null,
		userId: UserId,
	): Promise<PaymentDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(eq(orders.id, orderId));
			if (!order) {
				return undefined;
			}
			const [payment] = await tx
				.select({
					id: payments.id,
					method: payments.method,
					gatewayId: payments.gatewayId,
					amount: payments.amount,
					refunded: payments.refunded,
				})
				.from(payments)
				.where(
					and(
						eq(payments.orderId, orderId),
						eq(payments.status, "confirmed"),
					),
				)
				.for("update");
			if (!payment) {
				throw new ConflictException(
					"The order has no payment to refund",
				);
			}
			const left = payment.amount - payment.refunded;
			const value = amount ?? Money.parse(left);
			if (value > left) {
				invalid(
					`amount must be at most ${left}, what is left to refund`,
				);
			}
			// A confirmed payment came from the store's account, with its charge's id.
			const credential = (await this.accounts.credential(tx)) as string;
			await this.gateway
				.refund(credential, payment.gatewayId as string, value)
				.catch((error: unknown) => {
					if (error instanceof GatewayRefusal) {
						throw new ConflictException(error.message);
					}
					logger.error(
						`Refunding payment ${payment.id} failed: ${error}`,
					);
					throw new BadGatewayException(
						"The payment gateway did not answer; try again",
					);
				});
			const refunded = Money.parse(payment.refunded + value);
			const whole = refunded === payment.amount;
			await tx
				.update(payments)
				.set({
					refunded,
					...(whole && { status: "refunded" as const }),
				})
				.where(eq(payments.id, payment.id));
			await recordPaymentEvent(
				tx,
				orderId,
				"refund",
				{ paymentId: payment.id, amount: value },
				userId,
			);
			if (whole) {
				await recordPaymentEvent(
					tx,
					orderId,
					"payment",
					{
						paymentId: payment.id,
						method: payment.method,
						status: "refunded",
					},
					userId,
				);
			}
			return paymentView(tx, payment.id);
		});
	}

	/** The latest payment of the order behind the cart token; null without one. */
	async latest(tokenHash: string): Promise<PaymentDto | null | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(eq(orders.tokenHash, tokenHash));
			return order && ((await orderPayments(tx, order.id))[0] ?? null);
		});
	}

	/** Records the payment and gathers what the gateway needs to charge it. */
	private async start(
		tx: TenantTransaction,
		tokenHash: string,
		request: PaymentRequest,
		remoteIp: string,
	) {
		const [order] = await tx
			.select({
				id: orders.id,
				state: orders.state,
				number: orders.number,
				total: orders.total,
				customerId: customers.id,
				name: customers.name,
				email: customers.email,
				taxId: customers.taxId,
				phone: customers.phone,
				address: orders.billingAddress,
				shippingAddress: orders.shippingAddress,
			})
			.from(orders)
			.leftJoin(customers, eq(customers.id, orders.customerId))
			.where(eq(orders.tokenHash, tokenHash))
			.for("update", { of: orders });
		if (!order) {
			return undefined;
		}
		const [open] = await tx
			.select({ id: payments.id, method: payments.method })
			.from(payments)
			.where(
				and(
					eq(payments.orderId, order.id),
					inArray(payments.status, ["pending", "confirmed"]),
				),
			);
		if (
			open?.method === request.method &&
			(order.state === "awaiting_payment" || order.state === "paid")
		) {
			// A repeated request (a double click, a retry) answers the payment it made.
			return { existing: true as const, id: open.id };
		}
		if (order.state !== "awaiting_payment") {
			throw new ConflictException(
				"Only an order awaiting payment is paid",
			);
		}
		const credential = await this.accounts.credential(tx);
		if (!credential) {
			throw new ConflictException("The store does not take payments yet");
		}
		const { method, card } = request;
		const taxId =
			order.taxId ??
			request.taxId ??
			invalid("taxId is required: the store has none for the buyer");
		const phone =
			order.phone ??
			request.phone ??
			(method === "card"
				? invalid("phone is required to pay by card")
				: null);
		const address = order.address ?? order.shippingAddress;
		if (method === "card" && !address) {
			throw new ConflictException(
				"A card needs the order's billing address",
			);
		}
		const due = dueDate(new Date(), DAYS_TO_PAY[method]);
		const [{ id }] = await translateConstraints(
			() =>
				tx
					.insert(payments)
					.values({
						tenantId: TenantContext.id(),
						orderId: order.id,
						method,
						amount: order.total,
						dueDate: due,
					})
					.returning({ id: payments.id }),
			{
				payments_order_open_unique: () =>
					new ConflictException(
						"The order has a payment under way or done",
					),
			},
		);
		await recordPaymentEvent(tx, order.id, "payment", {
			paymentId: id,
			method,
			status: "pending",
		});
		const input: ChargeInput = {
			reference: id,
			method,
			amount: order.total,
			dueDate: due,
			description: `Pedido ${order.number}`,
			payer: {
				// A placed order always has its buyer, until erasure.
				reference: order.customerId as string,
				name: order.name as string,
				email: order.email as NonNullable<typeof order.email>,
				taxId,
				phone,
				cep: address?.cep ?? null,
				addressNumber: address?.number ?? null,
			},
			...(card && { card }),
			remoteIp,
			platformFeePercent: this.settings.feePercent,
		};
		return { existing: false as const, id, credential, input };
	}
}
