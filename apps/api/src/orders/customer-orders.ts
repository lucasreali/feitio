import { ConflictException } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { orders } from "../database/schemas/orders.js";
import type { CustomerId } from "../domain/ids.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { CustomerOrderDto } from "./order.dto.js";
import { linesOf } from "./order-lines.js";
import type { OrderState } from "./order-state.js";

/** Orders still to be paid or delivered, which need the buyer's data. */
const IN_PROGRESS: OrderState[] = [
	"awaiting_payment",
	"paid",
	"preparing",
	"shipped",
];

/** Every order and cart of the customer, newest first, for an LGPD access request. */
export async function customerOrders(
	tx: TenantTransaction,
	customerId: CustomerId,
): Promise<CustomerOrderDto[]> {
	const rows = await tx
		.select({
			id: orders.id,
			number: orders.number,
			state: orders.state,
			shippingAddress: orders.shippingAddress,
			billingAddress: orders.billingAddress,
			subtotal: orders.subtotal,
			discount: orders.discount,
			shipping: orders.shipping,
			total: orders.total,
			placedAt: orders.placedAt,
			createdAt: orders.createdAt,
		})
		.from(orders)
		.where(eq(orders.customerId, customerId))
		.orderBy(desc(orders.createdAt), desc(orders.id));
	return Promise.all(
		rows.map(async (order) => ({
			...order,
			lines: await linesOf(tx, order.id),
		})),
	);
}

/**
 * Before a customer is erased: removes their carts and clears the addresses
 * of their other orders, which keep their lines and totals and lose the
 * customer with the erasure. 409 while an order is still to be paid or
 * delivered. Locks the customer's orders first, so none is placed meanwhile.
 */
export async function releaseCustomerOrders(
	tx: TenantTransaction,
	customerId: CustomerId,
): Promise<void> {
	const own = await tx
		.select({ state: orders.state })
		.from(orders)
		.where(eq(orders.customerId, customerId))
		.for("update");
	if (own.some(({ state }) => IN_PROGRESS.includes(state))) {
		throw new ConflictException(
			"The customer has orders still to be paid or delivered",
		);
	}
	await tx
		.delete(orders)
		.where(
			and(eq(orders.customerId, customerId), eq(orders.state, "cart")),
		);
	await tx
		.update(orders)
		.set({ shippingAddress: null, billingAddress: null })
		.where(
			and(
				eq(orders.customerId, customerId),
				inArray(orders.state, ["delivered", "cancelled"]),
			),
		);
}
