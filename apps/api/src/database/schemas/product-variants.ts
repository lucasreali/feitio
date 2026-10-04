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
import type {
	AssetId,
	ProductId,
	ProductVariantId,
	TenantId,
} from "../../domain/ids.js";
import type { Money } from "../../domain/money.js";
import type { Sku } from "../../domain/sku.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { assets } from "./assets.js";
import { products } from "./products.js";
import { tenants } from "./tenants.js";

/**
 * What is sold: a product in one combination of its options, with its own
 * SKU, price and optional image. The id is what stock and orders will point
 * at, so the combination never changes after creation.
 */
export const productVariants = pgTable(
	"product_variants",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<ProductVariantId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		sku: text("sku").notNull().$type<Sku>(),
		/** In cents. */
		price: integer("price").notNull().$type<Money>(),
		assetId: uuid("asset_id").$type<AssetId>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("product_variants_tenant_product_id_unique").on(
			table.tenantId,
			table.productId,
			table.id,
		),
		unique("product_variants_tenant_sku_unique").on(
			table.tenantId,
			table.sku,
		),
		foreignKey({
			name: "product_variants_product_fk",
			columns: [table.tenantId, table.productId],
			foreignColumns: [products.tenantId, products.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "product_variants_asset_fk",
			columns: [table.tenantId, table.assetId],
			foreignColumns: [assets.tenantId, assets.id],
		}),
		check("product_variants_price_not_negative", sql`${table.price} >= 0`),
		check(
			"product_variants_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("product_variants"),
	],
).enableRLS();
