import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	jsonb,
	pgEnum,
	pgTable,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	OrderEventId,
	OrderId,
	TenantId,
	UserId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { orders } from "./orders.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * `transition`: the order changed state (`from`, `to`). `note`: written by
 * the store's staff, never shown to the buyer. `payment`: a payment started
 * or changed status (`paymentId`, `method`, `status`). `refund`: money went
 * back to the buyer (`paymentId`, `amount`).
 */
export const orderEventKind = pgEnum("order_event_kind", [
	"transition",
	"note",
	"payment",
	"refund",
]);

export type OrderEventKind = (typeof orderEventKind.enumValues)[number];

/** An order's history, append-only: the application never updates or deletes an entry. */
export const orderEvents = pgTable(
	"order_events",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<OrderEventId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		orderId: uuid("order_id").$type<OrderId>().notNull(),
		kind: orderEventKind("kind").notNull(),
		/** The transition's `from` and `to`, or the note. */
		data: jsonb("data")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		/** The panel user who did it; null when the buyer or the system did. */
		userId: uuid("user_id")
			.$type<UserId>()
			.references(() => users.id, { onDelete: "set null" }),
		// The time of the insert, so the entries of one change keep their order.
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
	},
	(table) => [
		foreignKey({
			name: "order_events_order_fk",
			columns: [table.tenantId, table.orderId],
			foreignColumns: [orders.tenantId, orders.id],
		}).onDelete("cascade"),
		index("order_events_order_idx").on(table.orderId, table.id),
		check(
			"order_events_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("order_events"),
	],
).enableRLS();
