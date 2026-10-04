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
	CustomerEventId,
	CustomerId,
	TenantId,
	UserId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { customers } from "./customers.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** What happened to a customer. `note` is written by the store's staff. */
export const customerEventKind = pgEnum("customer_event_kind", [
	"created",
	"registered",
	"profile_updated",
	"password_changed",
	"address_added",
	"address_updated",
	"address_removed",
	"added_to_group",
	"removed_from_group",
	"note",
]);

export type CustomerEventKind = (typeof customerEventKind.enumValues)[number];

/**
 * A customer's history, append-only: the application never updates or
 * deletes an entry; erasing the customer takes the history with it.
 */
export const customerEvents = pgTable(
	"customer_events",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<CustomerEventId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id").$type<CustomerId>().notNull(),
		kind: customerEventKind("kind").notNull(),
		/** Details of the entry: changed fields, the address, the group or the note. */
		data: jsonb("data")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		/** The panel user who did it; null when the customer or the system did. */
		userId: uuid("user_id")
			.$type<UserId>()
			.references(() => users.id, { onDelete: "set null" }),
		// The time of the insert, not of the transaction's start, so the entries
		// of one change keep their order.
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
	},
	(table) => [
		foreignKey({
			name: "customer_events_customer_fk",
			columns: [table.tenantId, table.customerId],
			foreignColumns: [customers.tenantId, customers.id],
		}).onDelete("cascade"),
		index("customer_events_customer_idx").on(table.customerId, table.id),
		check(
			"customer_events_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("customer_events"),
	],
).enableRLS();
