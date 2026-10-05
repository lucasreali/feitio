import { Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { orderEvents } from "../database/schemas/order-events.js";
import { orders } from "../database/schemas/orders.js";
import { payments } from "../database/schemas/payments.js";
import type { OrderId, PaymentId, UserId } from "../domain/ids.js";
import type { Money } from "../domain/money.js";
import { transitionOrder } from "../orders/order-transitions.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { GatewayCharge } from "./payment-gateway.js";

const logger = new Logger("Payments");

/** Adds a payment's change to its order's history. */
export async function recordPaymentEvent(
	tx: TenantTransaction,
	orderId: OrderId,
	kind: "payment" | "refund",
	data: Record<string, unknown>,
	userId: UserId | null = null,
): Promise<void> {
	await tx.insert(orderEvents).values({
		tenantId: TenantContext.id(),
		orderId,
		kind,
		data,
		userId,
	});
}

/** Fails a payment still pending, with the reason for the buyer. */
export async function failPayment(
	tx: TenantTransaction,
	id: PaymentId,
	failure: string,
): Promise<void> {
	const [payment] = await tx
		.update(payments)
		.set({ status: "failed", failure })
		.where(and(eq(payments.id, id), eq(payments.status, "pending")))
		.returning({ orderId: payments.orderId, method: payments.method });
	if (!payment) {
		return;
	}
	await recordPaymentEvent(tx, payment.orderId, "payment", {
		paymentId: id,
		method: payment.method,
		status: "failed",
	});
}

/**
 * Brings a payment up to what the gateway says of its charge, in the
 * caller's transaction: its status, the gateway's id and what the buyer
 * pays with. A change of status joins the order's history; a payment the
 * gateway confirms marks its order paid. Runs as often as the gateway is
 * heard (the charge's answer, webhooks, reconciliation): hearing the same
 * thing twice changes nothing.
 */
export async function settlePayment(
	tx: TenantTransaction,
	id: PaymentId,
	charge: GatewayCharge,
): Promise<void> {
	const [payment] = await tx
		.select({
			orderId: payments.orderId,
			method: payments.method,
			status: payments.status,
			amount: payments.amount,
			refunded: payments.refunded,
			details: payments.details,
		})
		.from(payments)
		.where(eq(payments.id, id))
		.for("update");
	if (!payment) {
		return;
	}
	const { id: gatewayId, reference: _, status, ...details } = charge;
	// Refunded in full, also when done at the gateway and not through us.
	const refunded = status === "refunded" ? payment.amount : payment.refunded;
	await tx
		.update(payments)
		.set({
			gatewayId,
			status,
			refunded,
			details: { ...payment.details, ...details },
		})
		.where(eq(payments.id, id));
	if (status !== payment.status) {
		await recordPaymentEvent(tx, payment.orderId, "payment", {
			paymentId: id,
			method: payment.method,
			status,
		});
	}
	if (refunded > payment.refunded) {
		await recordPaymentEvent(tx, payment.orderId, "refund", {
			paymentId: id,
			amount: (refunded - payment.refunded) as Money,
		});
	}
	if (status === "confirmed" && payment.status !== "confirmed") {
		await markPaid(tx, payment.orderId, id);
	}
}

/**
 * Moves an order awaiting payment to paid. Money for an order in any other
 * state (cancelled while the buyer paid, say) is logged and stays in the
 * order's history, for the staff to refund.
 *
 * ponytail: a log line is the only alert; the notifications phase can tell
 * the staff.
 */
async function markPaid(
	tx: TenantTransaction,
	orderId: OrderId,
	id: PaymentId,
) {
	const [order] = await tx
		.select({ state: orders.state })
		.from(orders)
		.where(eq(orders.id, orderId))
		.for("update");
	if (order?.state === "awaiting_payment") {
		await transitionOrder(tx, orderId, "paid", { party: "system" });
		return;
	}
	logger.warn(
		`Payment ${id} confirmed for order ${orderId} in ${order?.state}: refund it or settle the order`,
	);
}
