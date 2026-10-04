import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AssetId, TenantId } from "../../domain/ids.js";
import type { ObjectKey } from "../../storage/object-key.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * An image of the store's catalog. Assets are always in the public bucket, so
 * the row keeps only the key of the stored file, not its visibility.
 */
export const assets = pgTable(
	"assets",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<AssetId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		key: text("key").notNull().unique().$type<ObjectKey>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"assets_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("assets"),
	],
).enableRLS();
