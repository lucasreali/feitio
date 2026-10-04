import {
	foreignKey,
	integer,
	pgTable,
	primaryKey,
	uuid,
} from "drizzle-orm/pg-core";
import type { CollectionId, ProductId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { collections } from "./collections.js";
import { products } from "./products.js";
import { tenants } from "./tenants.js";

/** The products of a manual collection, in order. */
export const collectionProducts = pgTable(
	"collection_products",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		collectionId: uuid("collection_id").$type<CollectionId>().notNull(),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		position: integer("position").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.collectionId, table.productId] }),
		foreignKey({
			name: "collection_products_collection_fk",
			columns: [table.tenantId, table.collectionId],
			foreignColumns: [collections.tenantId, collections.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "collection_products_product_fk",
			columns: [table.tenantId, table.productId],
			foreignColumns: [products.tenantId, products.id],
		}).onDelete("cascade"),
		tenantIsolation("collection_products"),
	],
).enableRLS();
