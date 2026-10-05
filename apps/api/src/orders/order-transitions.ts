import { ConflictException } from "@nestjs/common";
import { and, eq, isNotNull, max, sql } from "drizzle-orm";
import { orderEvents } from "../database/schemas/order-events.js";
import { orderLines } from "../database/schemas/order-lines.js";
import { orders } from "../database/schemas/orders.js";
import type { OrderId, ProductVariantId, UserId } from "../domain/ids.js";
import { publishEvent } from "../events/publish-event.js";
import { moveStock } from "../stock/stock-ledger.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import {
	type OrderState,
	stockMovementOf,
	transitionAllowed,
} from "./order-state.js";

/** Who moves the order, and the panel user when it is the staff. */
export type OrderActor =
	| { party: "buyer" | "system" }
	| { party: "staff"; userId: UserId };

/**
 * The next number of the current store, after the last one given. A
 * transaction advisory lock per store makes concurrent placements wait, so
 * numbers never repeat nor skip.
 */
async function nextNumber(tx: TenantTransaction): Promise<number> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`order-number:${TenantContext.id()}`}, 0))`,
	);
	const [{ last }] = await tx
		.select({ last: max(orders.number) })
		.from(orders);
	return (last ?? 0) + 1;
}

/**
 * Moves an order to another state in the caller's transaction, for the
 * buyer, the staff or the system alike: checks the state machine (409 for a
 * transition it does not allow, or that the party may not make), moves the
 * stock of its lines (409 when there is not enough), numbers the order when
 * it is first placed, records the transition and publishes
 * `order.transitioned`. false when the store has no such order.
 */
export async function transitionOrder(
	tx: TenantTransaction,
	id: OrderId,
	to: OrderState,
	actor: OrderActor,
): Promise<boolean> {
	const [order] = await tx
		.select({ state: orders.state, number: orders.number })
		.from(orders)
		.where(eq(orders.id, id))
		.for("update");
	if (!order) {
		return false;
	}
	const from = order.state;
	if (!transitionAllowed(from, to, actor.party)) {
		throw new ConflictException(`An order in ${from} cannot go to ${to}`);
	}
	const kind = stockMovementOf(from, to);
	if (kind) {
		// Lines of removed variants have no stock left to move.
		const lines = await tx
			.select({
				variantId: sql<ProductVariantId>`${orderLines.variantId}`,
				quantity: orderLines.quantity,
			})
			.from(orderLines)
			.where(
				and(
					eq(orderLines.orderId, id),
					isNotNull(orderLines.variantId),
				),
			);
		await moveStock(tx, kind, lines);
	}
	const placing = to === "awaiting_payment" && order.number === null;
	await tx
		.update(orders)
		.set({
			state: to,
			...(placing && {
				number: await nextNumber(tx),
				placedAt: sql`now()`,
			}),
		})
		.where(eq(orders.id, id));
	await tx.insert(orderEvents).values({
		tenantId: TenantContext.id(),
		orderId: id,
		kind: "transition",
		data: { from, to },
		userId: actor.party === "staff" ? actor.userId : null,
	});
	await publishEvent(tx, {
		type: "order.transitioned",
		orderId: id,
		from,
		to,
	});
	return true;
}
