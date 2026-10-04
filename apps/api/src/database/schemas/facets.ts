import { sql } from "drizzle-orm";
import {
	check,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { FacetId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/** An attribute products are filtered by, such as Brand or Material. */
export const facets = pgTable(
	"facets",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<FacetId>(),
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
		unique("facets_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("facets_tenant_name_unique").on(table.tenantId, table.name),
		check(
			"facets_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("facets"),
	],
).enableRLS();
