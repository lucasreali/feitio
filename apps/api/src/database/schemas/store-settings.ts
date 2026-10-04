import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/** Theme variables shared with the UIs (src/styles.css in admin, checkout and the starter). */
export const themeVariables = [
	"background",
	"foreground",
	"primary",
	"primary-foreground",
	"muted",
	"muted-foreground",
	"accent",
	"border",
	"destructive",
	"radius",
] as const;

export type ThemeVariable = (typeof themeVariables)[number];

/** A store's theme; variables left out keep the UI defaults. */
export type StoreTheme = Partial<Record<ThemeVariable, string>>;

/** Storefront and checkout settings of a tenant: one row per tenant. */
export const storeSettings = pgTable(
	"store_settings",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.primaryKey()
			.references(() => tenants.id, { onDelete: "cascade" }),
		displayName: text("display_name").notNull(),
		// Domain types: the logo URL and the theme's CSS values stay plain strings
		// for now. Nothing writes them through the API yet; wrap them together
		// with their validation when the first write route appears.
		logoUrl: text("logo_url"),
		theme: jsonb("theme").$type<StoreTheme>().notNull().default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	() => [tenantIsolation("store_settings")],
).enableRLS();
