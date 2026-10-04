import { sql } from "drizzle-orm";
import { pgPolicy } from "drizzle-orm/pg-core";
import { appRole } from "./roles.js";

/**
 * Tenant of the current transaction, set by TenantDatabase.run with
 * `set_config('app.tenant_id', ..., true)`. Outside one it is NULL; `nullif`
 * covers the '' a pooled connection reports once the setting has been used.
 */
export const currentTenantId = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

/**
 * User of the current transaction, set with `set_config('app.user_id', ...,
 * true)` to read a user's own rows before a tenant is chosen (sign-in).
 */
export const currentUserId = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

/**
 * The RLS policy every business table needs (its `tenant_id` column must
 * reference tenants): the application role reads and writes only the current
 * tenant's rows, and outside a tenant transaction no row matches.
 */
export const tenantIsolation = (table: string) =>
	pgPolicy(`${table}_tenant_isolation`, {
		for: "all",
		to: appRole,
		using: sql`tenant_id = ${currentTenantId}`,
		withCheck: sql`tenant_id = ${currentTenantId}`,
	});
