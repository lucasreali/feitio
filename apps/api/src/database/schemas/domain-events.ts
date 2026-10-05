import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { DomainEventId, TenantId } from "../../domain/ids.js";
import { appRole } from "../roles.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * Set with `set_config('app.event_relay', 'on', true)` only by the worker's
 * relay, which moves every store's pending events to the queue.
 */
const isEventRelay = sql`current_setting('app.event_relay', true) = 'on'`;

/**
 * Transactional outbox: modules write events in the transaction of the change
 * (`publishEvent`), and the worker's relay puts them on the queue. Only
 * `dispatched_at` ever changes; erasing the tenant takes the events with it.
 */
export const domainEvents = pgTable(
	"domain_events",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<DomainEventId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		// Text, not an enum: the type union lives in code (`DomainEvent`), and new
		// events should not need a migration.
		type: text("type").notNull(),
		/** The event without its type. Ids and numbers only, never personal data. */
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** When the relay put it on the queue; null while pending. */
		dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
	},
	(table) => [
		index("domain_events_pending_idx")
			.on(table.id)
			.where(sql`${table.dispatchedAt} is null`),
		check(
			"domain_events_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("domain_events"),
		pgPolicy("domain_events_relay_read", {
			for: "select",
			to: appRole,
			using: isEventRelay,
		}),
		pgPolicy("domain_events_relay_dispatch", {
			for: "update",
			to: appRole,
			using: isEventRelay,
			withCheck: isEventRelay,
		}),
	],
).enableRLS();
