import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { ShippingMethodId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * How a method prices shipping, each kind an adapter in `src/shipping/`:
 * `fixed` (one price, optionally free from a subtotal on), `melhor_envio`
 * (a carrier's service through the Melhor Envio aggregator) and `pickup`
 * (the buyer picks the order up at the store).
 */
export const shippingKind = pgEnum("shipping_kind", [
	"fixed",
	"melhor_envio",
	"pickup",
]);

export type ShippingKind = (typeof shippingKind.enumValues)[number];

/**
 * A way the store ships, offered to buyers while enabled. The kind never
 * changes; `config` holds the kind's settings, as its calculator validated
 * them. Methods are disabled, never removed, since orders point at them.
 */
export const shippingMethods = pgTable(
	"shipping_methods",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<ShippingMethodId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		/** What the buyer sees, such as "Sedex" or "Retirada na loja (Rua X, 10)". */
		name: text("name").notNull(),
		kind: shippingKind("kind").notNull(),
		config: jsonb("config").notNull().default({}),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("shipping_methods_tenant_id_id_unique").on(
			table.tenantId,
			table.id,
		),
		unique("shipping_methods_tenant_name_unique").on(
			table.tenantId,
			table.name,
		),
		check(
			"shipping_methods_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("shipping_methods"),
	],
).enableRLS();
