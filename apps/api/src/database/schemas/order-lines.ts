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
	OrderId,
	OrderLineId,
	ProductVariantId,
	TenantId,
} from "../../domain/ids.js";
import type { Money } from "../../domain/money.js";
import type { Sku } from "../../domain/sku.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { orders } from "./orders.js";
import { productVariants } from "./product-variants.js";
import { tenants } from "./tenants.js";

/**
 * A variant in an order, with its quantity and unit price. The price, the
 * product's name and the SKU are copies taken by the API, so a placed order
 * keeps them when the catalog changes or the variant is removed.
 */
export const orderLines = pgTable(
	"order_lines",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<OrderLineId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		orderId: uuid("order_id").$type<OrderId>().notNull(),
		/** Null once the variant is removed from the catalog. */
		variantId: uuid("variant_id").$type<ProductVariantId>(),
		productName: text("product_name").notNull(),
		sku: text("sku").notNull().$type<Sku>(),
		quantity: integer("quantity").notNull(),
		unitPrice: integer("unit_price").notNull().$type<Money>(),
		/** Order within the order: lines keep the order they were added in. */
		position: integer("position").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		foreignKey({
			name: "order_lines_order_fk",
			columns: [table.tenantId, table.orderId],
			foreignColumns: [orders.tenantId, orders.id],
		}).onDelete("cascade"),
		// The migration narrows the action to SET NULL (variant_id).
		foreignKey({
			name: "order_lines_variant_fk",
			columns: [table.tenantId, table.variantId],
			foreignColumns: [productVariants.tenantId, productVariants.id],
		}).onDelete("set null"),
		unique("order_lines_order_variant_unique").on(
			table.orderId,
			table.variantId,
		),
		check("order_lines_quantity_positive", sql`${table.quantity} > 0`),
		check(
			"order_lines_unit_price_not_negative",
			sql`${table.unitPrice} >= 0`,
		),
		check(
			"order_lines_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("order_lines"),
	],
).enableRLS();
