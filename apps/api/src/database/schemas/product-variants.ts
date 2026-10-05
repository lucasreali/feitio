import { sql } from "drizzle-orm";
import {
	boolean,
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
		/** Order within the product. */
		position: integer("position").notNull(),
		/** false: sold without counting stock. */
		trackStock: boolean("track_stock").notNull().default(true),
		/** Sold past zero (backorder) when stock is tracked. */
		allowBackorder: boolean("allow_backorder").notNull().default(false),
		/** The panel warns when available stock is at or below it; null: never. */
		lowStockThreshold: integer("low_stock_threshold"),
		/** In grams, for shipping; null: unknown. */
		weight: integer("weight"),
		/** Sides of the package, in centimeters, for shipping; null: unknown. */
		height: integer("height"),
		width: integer("width"),
		length: integer("length"),
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
		// Target of the stock tables' composite foreign keys.
		unique("product_variants_tenant_id_id_unique").on(
			table.tenantId,
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
			"product_variants_low_stock_threshold_not_negative",
			sql`${table.lowStockThreshold} >= 0`,
		),
		check(
			"product_variants_size_positive",
			sql`${table.weight} > 0 and ${table.height} > 0 and ${table.width} > 0 and ${table.length} > 0`,
		),
		check(
			"product_variants_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("product_variants"),
	],
).enableRLS();
