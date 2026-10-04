import { sql } from "drizzle-orm";
import {
	check,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { ProductId, TenantId } from "../../domain/ids.js";
import type { Slug } from "../../domain/slug.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/** Only `active` products reach the stores; `archived` replaces deletion. */
export const productStatus = pgEnum("product_status", [
	"draft",
	"active",
	"archived",
]);

export type ProductStatus = (typeof productStatus.enumValues)[number];

/**
 * A product of the store's catalog. What is sold is its variants: every
 * product has at least one (a deferred trigger refuses to commit one without),
 * and the price lives on the variant.
 *
 * References between catalog tables are composite, `(tenant_id, x_id)`, and
 * point at a `(tenant_id, id)` unique key: foreign key checks skip RLS, so a
 * plain `x_id` would accept another tenant's id.
 */
export const products = pgTable(
	"products",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<ProductId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull().$type<Slug>(),
		/** Plain text; the stores escape it like any other text. */
		description: text("description").notNull().default(""),
		status: productStatus("status").notNull().default("draft"),
		seoTitle: text("seo_title"),
		seoDescription: text("seo_description"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("products_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("products_tenant_slug_unique").on(table.tenantId, table.slug),
		check(
			"products_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("products"),
	],
).enableRLS();
