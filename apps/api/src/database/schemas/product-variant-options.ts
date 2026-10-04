import { foreignKey, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import type {
	ProductId,
	ProductOptionGroupId,
	ProductOptionId,
	ProductVariantId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { productOptions } from "./product-options.js";
import { productVariants } from "./product-variants.js";
import { tenants } from "./tenants.js";

/**
 * A variant's option in each group. The keys carry the product and the group,
 * so the database refuses an option of another product and a second option
 * of the same group; an option in use cannot be removed.
 */
export const productVariantOptions = pgTable(
	"product_variant_options",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		variantId: uuid("variant_id").$type<ProductVariantId>().notNull(),
		groupId: uuid("group_id").$type<ProductOptionGroupId>().notNull(),
		optionId: uuid("option_id").$type<ProductOptionId>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.variantId, table.groupId] }),
		foreignKey({
			name: "product_variant_options_variant_fk",
			columns: [table.tenantId, table.productId, table.variantId],
			foreignColumns: [
				productVariants.tenantId,
				productVariants.productId,
				productVariants.id,
			],
		}).onDelete("cascade"),
		foreignKey({
			name: "product_variant_options_option_fk",
			columns: [
				table.tenantId,
				table.productId,
				table.groupId,
				table.optionId,
			],
			foreignColumns: [
				productOptions.tenantId,
				productOptions.productId,
				productOptions.groupId,
				productOptions.id,
			],
		}),
		tenantIsolation("product_variant_options"),
	],
).enableRLS();
