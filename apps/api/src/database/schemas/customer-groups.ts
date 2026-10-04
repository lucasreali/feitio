import { sql } from "drizzle-orm";
import {
	check,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { CustomerGroupId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/** A group of customers (wholesale, VIP...), for promotions and prices. */
export const customerGroups = pgTable(
	"customer_groups",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<CustomerGroupId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("customer_groups_tenant_id_id_unique").on(
			table.tenantId,
			table.id,
		),
		unique("customer_groups_tenant_name_unique").on(
			table.tenantId,
			table.name,
		),
		check(
			"customer_groups_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("customer_groups"),
	],
).enableRLS();
