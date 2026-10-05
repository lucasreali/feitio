import {
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * Jobs the worker has run, written in the transaction of the job's own
 * writes: a job that runs again (a retry, a stalled job) finds its key and
 * changes nothing. Webhooks received keep their keys here too
 * (`asaas-webhook.<id>`), so one delivered twice is queued once.
 */
export const processedJobs = pgTable(
	"processed_jobs",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		/** The idempotency key: event id and handler name, or a webhook's id. */
		key: text("key").notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.tenantId, table.key] }),
		tenantIsolation("processed_jobs"),
	],
).enableRLS();
