import {
	foreignKey,
	integer,
	pgTable,
	primaryKey,
	uuid,
} from "drizzle-orm/pg-core";
import type { AssetId, ProductId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { assets } from "./assets.js";
import { products } from "./products.js";
import { tenants } from "./tenants.js";

/** A product's images, in order. An asset in use cannot be removed. */
export const productImages = pgTable(
	"product_images",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		assetId: uuid("asset_id").$type<AssetId>().notNull(),
		position: integer("position").notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.assetId] }),
		foreignKey({
			name: "product_images_product_fk",
			columns: [table.tenantId, table.productId],
			foreignColumns: [products.tenantId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "product_images_asset_fk",
			columns: [table.tenantId, table.assetId],
			foreignColumns: [assets.tenantId, assets.id],
		}),
		tenantIsolation("product_images"),
	],
).enableRLS();
