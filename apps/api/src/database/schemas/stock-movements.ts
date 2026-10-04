import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgTable,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	ProductVariantId,
	StockLocationId,
	StockMovementId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { productVariants } from "./product-variants.js";
import { stockLocations } from "./stock-locations.js";
import { tenants } from "./tenants.js";

/**
 * `adjustment`: a count by the store, the only kind with a signed quantity.
 * `reservation`: available to reserved, for an order awaiting payment.
 * `sale`: reserved units leave with a paid order.
 * `release`: reserved back to available (order cancelled or expired).
 * `return`: sold units back to available.
 */
export const stockMovementKind = pgEnum("stock_movement_kind", [
	"adjustment",
	"reservation",
	"sale",
	"release",
	"return",
]);

export type StockMovementKind = (typeof stockMovementKind.enumValues)[number];

/** Every change to a stock level, append-only: the application never updates or deletes one. */
export const stockMovements = pgTable(
	"stock_movements",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<StockMovementId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		locationId: uuid("location_id").$type<StockLocationId>().notNull(),
		variantId: uuid("variant_id").$type<ProductVariantId>().notNull(),
		kind: stockMovementKind("kind").notNull(),
		quantity: integer("quantity").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "stock_movements_location_fk",
			columns: [table.tenantId, table.locationId],
			foreignColumns: [stockLocations.tenantId, stockLocations.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "stock_movements_variant_fk",
			columns: [table.tenantId, table.variantId],
			foreignColumns: [productVariants.tenantId, productVariants.id],
		}).onDelete("cascade"),
		check(
			"stock_movements_quantity",
			sql`${table.quantity} > 0 or (${table.kind} = 'adjustment' and ${table.quantity} <> 0)`,
		),
		check(
			"stock_movements_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		index("stock_movements_variant_idx").on(table.variantId, table.id),
		tenantIsolation("stock_movements"),
	],
).enableRLS();
