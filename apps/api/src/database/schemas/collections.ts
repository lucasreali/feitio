import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { CollectionId, TenantId } from "../../domain/ids.js";
import type { Slug } from "../../domain/slug.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * `manual`: the products picked in collection_products, in their order.
 * `rule`: every product with all the facet values in collection_facet_values,
 * worked out when read. The kind never changes after creation.
 */
export const collectionKind = pgEnum("collection_kind", ["manual", "rule"]);

export type CollectionKind = (typeof collectionKind.enumValues)[number];

/** A group of products for the stores' navigation, nested through parent_id. */
export const collections = pgTable(
	"collections",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<CollectionId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull().$type<Slug>(),
		description: text("description").notNull().default(""),
		kind: collectionKind("kind").notNull(),
		/** Null for a top-level collection. A collection with children cannot be removed. */
		parentId: uuid("parent_id").$type<CollectionId>(),
		/** Order among the collections with the same parent. */
		position: integer("position").notNull(),
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
		unique("collections_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("collections_tenant_slug_unique").on(table.tenantId, table.slug),
		foreignKey({
			name: "collections_parent_fk",
			columns: [table.tenantId, table.parentId],
			foreignColumns: [table.tenantId, table.id],
		}),
		check(
			"collections_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("collections"),
	],
).enableRLS();
