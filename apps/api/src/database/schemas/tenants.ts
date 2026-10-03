import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", ["active", "inactive"]);

/** A merchant on the platform. */
export const tenants = pgTable("tenants", {
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
});
