import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { customers } from "../database/schemas/customers.js";
import { orders } from "../database/schemas/orders.js";
import { storeSettings } from "../database/schemas/store-settings.js";
import { tenants } from "../database/schemas/tenants.js";
import { Money } from "../domain/money.js";
import type { DomainEvent } from "../events/domain-event.js";
import type { EventHandler } from "../events/event-handler.js";
import { linesOf } from "../orders/order-lines.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import { EMAIL_SENDER, type EmailSender } from "./email-sender.js";
import { orderEmail, orderEmailKind, type StoreBrand } from "./order-emails.js";

/** The store's name, logo and colors; a store without settings shows its name. */
export async function storeBrand(tx: TenantTransaction): Promise<StoreBrand> {
	const [settings] = await tx
		.select({
			name: storeSettings.displayName,
			logoUrl: storeSettings.logoUrl,
			theme: storeSettings.theme,
		})
		.from(storeSettings)
		.limit(1);
	if (settings) {
		return settings;
	}
	const [tenant] = await tx
		.select({ name: tenants.name })
		.from(tenants)
		.where(eq(tenants.id, TenantContext.id()));
	return { name: tenant.name, logoUrl: null, theme: {} };
}

/**
 * E-mails the buyer when their order is placed, paid, shipped or cancelled
 * (in the worker). The order is read when the job runs, so a shipped order
 * carries the tracking code the staff set.
 */
@Injectable()
export class OrderNotifications implements EventHandler {
	readonly name = "order-email";
	readonly events = ["order.transitioned"] as const;

	constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

	async handle(
		event: DomainEvent,
		{ tx, key }: { tx: TenantTransaction; key: string },
	): Promise<void> {
		if (event.type !== "order.transitioned") {
			return;
		}
		const kind = orderEmailKind(event.from, event.to);
		if (!kind) {
			return;
		}
		const [order] = await tx
			.select({
				number: orders.number,
				email: customers.email,
				customerName: customers.name,
				subtotal: orders.subtotal,
				discount: orders.discount,
				shipping: orders.shipping,
				total: orders.total,
				shippingMethodName: orders.shippingMethodName,
				trackingCode: orders.trackingCode,
			})
			.from(orders)
			.innerJoin(customers, eq(customers.id, orders.customerId))
			.where(eq(orders.id, event.orderId));
		// A customer erased since then has no one to tell.
		if (!order?.number) {
			return;
		}
		const lines = (await linesOf(tx, event.orderId)).map((line) => ({
			productName: line.productName,
			quantity: line.quantity,
			total: Money.parse(line.total),
		}));
		const store = await storeBrand(tx);
		await this.sender.send(
			{
				to: order.email,
				fromName: store.name,
				...orderEmail(
					kind,
					{ ...order, number: order.number, lines },
					store,
				),
			},
			key,
		);
	}
}
