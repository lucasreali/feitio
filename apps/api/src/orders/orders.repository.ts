import { ConflictException, Injectable } from "@nestjs/common";
import { and, count, desc, eq, ilike, ne, type SQL, sql } from "drizzle-orm";
import { contains } from "../customers/customers.repository.js";
import { customers } from "../database/schemas/customers.js";
import { orderEvents } from "../database/schemas/order-events.js";
import { orders } from "../database/schemas/orders.js";
import { users } from "../database/schemas/users.js";
import type { HttpsUrl } from "../domain/https-url.js";
import type { CustomerId, OrderId, UserId } from "../domain/ids.js";
import type { Page } from "../http/page.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type { OrderDto, OrderEventDto, OrderSummaryDto } from "./order.dto.js";
import { linesOf, shippingMethodOf } from "./order-lines.js";
import type { OrderState } from "./order-state.js";
import { transitionOrder } from "./order-transitions.js";

export interface OrderFilter {
	/** Without it, every state but `cart`. */
	state?: OrderState;
	customerId?: CustomerId;
	/** The order's number (digits alone), or part of the buyer's e-mail. */
	search?: string;
}

/** Placed orders first by when they were placed, newest first. */
const newestFirst = [
	desc(sql`coalesce(${orders.placedAt}, ${orders.createdAt})`),
	desc(orders.id),
];

const customerRef = sql<{
	id: string;
	name: string;
	email: string;
} | null>`case when ${customers.id} is null then null else json_build_object('id', ${customers.id}, 'name', ${customers.name}, 'email', ${customers.email}) end`;

/** The order behind the id, locked; false when the store has none. */
async function lockOrder(tx: TenantTransaction, id: OrderId) {
	const rows = await tx
		.select({ id: orders.id })
		.from(orders)
		.where(eq(orders.id, id))
		.for("update");
	return rows.length > 0;
}

const entries = (tx: TenantTransaction) =>
	tx
		.select({
			id: orderEvents.id,
			kind: orderEvents.kind,
			data: orderEvents.data,
			userId: users.id,
			userName: users.name,
			createdAt: orderEvents.createdAt,
		})
		.from(orderEvents)
		.leftJoin(users, eq(users.id, orderEvents.userId))
		.$dynamic();

const toEntry = ({
	userId,
	userName,
	...entry
}: Awaited<ReturnType<typeof entries>>[number]): OrderEventDto => ({
	...entry,
	// A removed panel user leaves the entry without its author.
	user: userId && userName ? { id: userId, name: userName } : null,
});

/** The carrier's tracking code and the label to print, when shipping. */
export interface Shipment {
	trackingCode: string | null;
	labelUrl: HttpsUrl | null;
}

/** States in which an order has a shipment to record: paid until shipped. */
const SHIPPABLE: OrderState[] = ["paid", "preparing", "shipped"];

/** The current tenant's orders, as the panel sees and moves them. */
@Injectable()
export class OrdersRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	list(
		page: Page,
		{ state, customerId, search }: OrderFilter,
	): Promise<{ items: OrderSummaryDto[]; total: number }> {
		const where: SQL | undefined = and(
			state ? eq(orders.state, state) : ne(orders.state, "cart"),
			customerId ? eq(orders.customerId, customerId) : undefined,
			// Digits alone are a number, which would match many e-mails.
			search === undefined
				? undefined
				: /^\d{1,9}$/.test(search)
					? eq(orders.number, Number(search))
					: ilike(customers.email, contains(search)),
		);
		return this.tenantDb.run(async (tx) => {
			const [items, [{ total }]] = await Promise.all([
				tx
					.select({
						id: orders.id,
						number: orders.number,
						state: orders.state,
						customer: customerRef,
						total: orders.total,
						placedAt: orders.placedAt,
						createdAt: orders.createdAt,
					})
					.from(orders)
					.leftJoin(customers, eq(customers.id, orders.customerId))
					.where(where)
					.orderBy(...newestFirst)
					.limit(page.pageSize)
					.offset(page.offset),
				tx
					.select({ total: count() })
					.from(orders)
					.leftJoin(customers, eq(customers.id, orders.customerId))
					.where(where),
			]);
			return { items, total };
		});
	}

	find(id: OrderId): Promise<OrderDto | undefined> {
		return this.tenantDb.run((tx) => this.view(tx, id));
	}

	/**
	 * Moves the order as the staff; undefined when the store has no such
	 * order, 409 for a transition the staff may not make or without stock.
	 */
	transition(
		id: OrderId,
		to: OrderState,
		userId: UserId,
	): Promise<OrderDto | undefined> {
		return this.tenantDb.run(async (tx) =>
			(await transitionOrder(tx, id, to, { party: "staff", userId }))
				? this.view(tx, id)
				: undefined,
		);
	}

	/**
	 * Records the shipment of a paid order; undefined when the store has no
	 * such order, 409 before payment or after delivery or cancellation.
	 */
	setShipment(
		id: OrderId,
		shipment: Shipment,
	): Promise<OrderDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ state: orders.state })
				.from(orders)
				.where(eq(orders.id, id))
				.for("update");
			if (!order) {
				return undefined;
			}
			if (!SHIPPABLE.includes(order.state)) {
				throw new ConflictException(
					`An order in ${order.state} has no shipment to record`,
				);
			}
			await tx.update(orders).set(shipment).where(eq(orders.id, id));
			return this.view(tx, id);
		});
	}

	/** Newest first; undefined when the store has no such order. */
	history(
		id: OrderId,
		page: Page,
	): Promise<{ items: OrderEventDto[]; total: number } | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(eq(orders.id, id));
			if (!order) {
				return undefined;
			}
			const [items, [{ total }]] = await Promise.all([
				entries(tx)
					.where(eq(orderEvents.orderId, id))
					.orderBy(desc(orderEvents.createdAt), desc(orderEvents.id))
					.limit(page.pageSize)
					.offset(page.offset),
				tx
					.select({ total: count() })
					.from(orderEvents)
					.where(eq(orderEvents.orderId, id)),
			]);
			return { items: items.map(toEntry), total };
		});
	}

	/** A note by the staff; undefined when the store has no such order. */
	addNote(
		id: OrderId,
		note: string,
		userId: UserId,
	): Promise<OrderEventDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			if (!(await lockOrder(tx, id))) {
				return undefined;
			}
			const [{ eventId }] = await tx
				.insert(orderEvents)
				.values({
					tenantId: TenantContext.id(),
					orderId: id,
					kind: "note",
					data: { note },
					userId,
				})
				.returning({ eventId: orderEvents.id });
			const [entry] = await entries(tx).where(
				eq(orderEvents.id, eventId),
			);
			return toEntry(entry);
		});
	}

	private async view(
		tx: TenantTransaction,
		id: OrderId,
	): Promise<OrderDto | undefined> {
		const [order] = await tx
			.select({
				id: orders.id,
				number: orders.number,
				state: orders.state,
				customer: sql<
					OrderDto["customer"]
				>`case when ${customers.id} is null then null else json_build_object('id', ${customers.id}, 'name', ${customers.name}, 'email', ${customers.email}, 'phone', ${customers.phone}, 'taxId', ${customers.taxId}) end`,
				shippingAddress: orders.shippingAddress,
				billingAddress: orders.billingAddress,
				subtotal: orders.subtotal,
				discount: orders.discount,
				shipping: orders.shipping,
				total: orders.total,
				shippingMethod: shippingMethodOf,
				trackingCode: orders.trackingCode,
				labelUrl: orders.labelUrl,
				placedAt: orders.placedAt,
				createdAt: orders.createdAt,
				updatedAt: orders.updatedAt,
			})
			.from(orders)
			.leftJoin(customers, eq(customers.id, orders.customerId))
			.where(eq(orders.id, id));
		return order && { ...order, lines: await linesOf(tx, id) };
	}
}
