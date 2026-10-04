import { sql } from "drizzle-orm";
import {
	pgEnum,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { appRole } from "../roles.js";

export const tenantStatus = pgEnum("tenant_status", ["active", "inactive"]);

/** A merchant on the platform. */
export const tenants = pgTable(
	"tenants",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		/** Short unique identifier used in URLs. */
		slug: text("slug").notNull().unique(),
		status: tenantStatus("status").notNull().default("active"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	() => [
		// The API only reads tenants, to resolve the X-Tenant header. Tenants are
		// managed by the table owner; no other role gets any access.
		pgPolicy("tenants_app_read", {
			for: "select",
			to: appRole,
			using: sql`true`,
		}),
	],
).enableRLS();
