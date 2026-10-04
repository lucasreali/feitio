import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgTable,
	primaryKey,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	ProductVariantId,
	StockLocationId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { productVariants } from "./product-variants.js";
import { stockLocations } from "./stock-locations.js";
import { tenants } from "./tenants.js";

/**
 * A variant's balance in a location. `available` can be sold; `reserved` is
 * held by orders awaiting payment. Units in hand are their sum. `available`
 * goes below zero only for variants that allow backorders. Written only
 * through the stock ledger (src/stock/stock-ledger.ts), with a movement for
 * every change; no row means nothing in stock.
 */
export const stockLevels = pgTable(
	"stock_levels",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		locationId: uuid("location_id").$type<StockLocationId>().notNull(),
		variantId: uuid("variant_id").$type<ProductVariantId>().notNull(),
		available: integer("available").notNull().default(0),
		reserved: integer("reserved").notNull().default(0),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		primaryKey({ columns: [table.locationId, table.variantId] }),
		foreignKey({
			name: "stock_levels_location_fk",
			columns: [table.tenantId, table.locationId],
			foreignColumns: [stockLocations.tenantId, stockLocations.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "stock_levels_variant_fk",
			columns: [table.tenantId, table.variantId],
			foreignColumns: [productVariants.tenantId, productVariants.id],
		}).onDelete("cascade"),
		check(
			"stock_levels_reserved_not_negative",
			sql`${table.reserved} >= 0`,
		),
		tenantIsolation("stock_levels"),
	],
).enableRLS();
