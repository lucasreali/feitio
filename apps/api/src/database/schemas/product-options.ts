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
	ProductOptionId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { productOptionGroups } from "./product-option-groups.js";
import { tenants } from "./tenants.js";

/** A value of an option group, such as M in Size. */
export const productOptions = pgTable(
	"product_options",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<ProductOptionId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		productId: uuid("product_id").$type<ProductId>().notNull(),
		groupId: uuid("group_id").$type<ProductOptionGroupId>().notNull(),
		name: text("name").notNull(),
		/** Order within the group. */
		position: integer("position").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("product_options_tenant_product_group_id_unique").on(
			table.tenantId,
			table.productId,
			table.groupId,
			table.id,
		),
		unique("product_options_group_name_unique").on(
			table.groupId,
			table.name,
		),
		foreignKey({
			name: "product_options_group_fk",
			columns: [table.tenantId, table.productId, table.groupId],
			foreignColumns: [
				productOptionGroups.tenantId,
				productOptionGroups.productId,
				productOptionGroups.id,
			],
		}).onDelete("cascade"),
		check(
			"product_options_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("product_options"),
	],
).enableRLS();
