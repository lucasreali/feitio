import {
	foreignKey,
	index,
	pgTable,
	primaryKey,
	uuid,
} from "drizzle-orm/pg-core";
import type { FacetValueId, ProductId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { facetValues } from "./facet-values.js";
import { products } from "./products.js";
import { tenants } from "./tenants.js";

/** The facet values a product has; removing a value takes it off its products. */
export const productFacetValues = pgTable(
	"product_facet_values",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		facetValueId: uuid("facet_value_id").$type<FacetValueId>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.facetValueId] }),
		// Store filters and rule collections look products up by value.
		index("product_facet_values_value_idx").on(
			table.facetValueId,
			table.productId,
		),
		foreignKey({
			name: "product_facet_values_product_fk",
			columns: [table.tenantId, table.productId],
			foreignColumns: [products.tenantId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "product_facet_values_value_fk",
			columns: [table.tenantId, table.facetValueId],
			foreignColumns: [facetValues.tenantId, facetValues.id],
		}).onDelete("cascade"),
		tenantIsolation("product_facet_values"),
	],
).enableRLS();
