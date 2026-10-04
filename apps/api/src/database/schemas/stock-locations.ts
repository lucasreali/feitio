import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { StockLocationId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * A place where the store keeps stock. Each store has one default location,
 * created with its first stock write; the model accepts more.
 */
export const stockLocations = pgTable(
	"stock_locations",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<StockLocationId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		isDefault: boolean("is_default").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("stock_locations_tenant_id_id_unique").on(
			table.tenantId,
			table.id,
		),
		uniqueIndex("stock_locations_one_default")
			.on(table.tenantId)
			.where(sql`${table.isDefault}`),
		check(
			"stock_locations_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("stock_locations"),
	],
).enableRLS();
