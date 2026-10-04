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
	ProductId,
	ProductOptionGroupId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { products } from "./products.js";
import { tenants } from "./tenants.js";

/** A dimension a product varies in, such as Size or Color. */
export const productOptionGroups = pgTable(
	"product_option_groups",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<ProductOptionGroupId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		name: text("name").notNull(),
		/** Order within the product. */
		position: integer("position").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		// Options carry the product too, so a variant can only use its own product's options.
		unique("product_option_groups_tenant_product_id_unique").on(
			table.tenantId,
			table.productId,
			table.id,
		),
		unique("product_option_groups_product_name_unique").on(
			table.productId,
			table.name,
		),
		foreignKey({
			name: "product_option_groups_product_fk",
			columns: [table.tenantId, table.productId],
			foreignColumns: [products.tenantId, products.id],
		}).onDelete("cascade"),
		check(
			"product_option_groups_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("product_option_groups"),
	],
).enableRLS();
