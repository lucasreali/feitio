import { foreignKey, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import type { CollectionId, FacetValueId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { collections } from "./collections.js";
import { facetValues } from "./facet-values.js";
import { tenants } from "./tenants.js";

/**
 * The rule of a rule collection: its products have all these facet values.
 * A facet value a rule uses cannot be removed.
 */
export const collectionFacetValues = pgTable(
	"collection_facet_values",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		collectionId: uuid("collection_id").$type<CollectionId>().notNull(),
		facetValueId: uuid("facet_value_id").$type<FacetValueId>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.collectionId, table.facetValueId] }),
		foreignKey({
			name: "collection_facet_values_collection_fk",
			columns: [table.tenantId, table.collectionId],
			foreignColumns: [collections.tenantId, collections.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "collection_facet_values_value_fk",
			columns: [table.tenantId, table.facetValueId],
			foreignColumns: [facetValues.tenantId, facetValues.id],
		}),
		tenantIsolation("collection_facet_values"),
	],
).enableRLS();
