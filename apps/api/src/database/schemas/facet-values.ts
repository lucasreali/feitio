import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { FacetId, FacetValueId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { facets } from "./facets.js";
import { tenants } from "./tenants.js";

/** A value of a facet, such as Nike in Brand. */
export const facetValues = pgTable(
	"facet_values",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<FacetValueId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		facetId: uuid("facet_id").$type<FacetId>().notNull(),
		name: text("name").notNull(),
		/** Order within the facet. */
		position: integer("position").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("facet_values_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("facet_values_facet_name_unique").on(table.facetId, table.name),
		foreignKey({
			name: "facet_values_facet_fk",
			columns: [table.tenantId, table.facetId],
			foreignColumns: [facets.tenantId, facets.id],
		}).onDelete("cascade"),
		check(
			"facet_values_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("facet_values"),
	],
).enableRLS();
