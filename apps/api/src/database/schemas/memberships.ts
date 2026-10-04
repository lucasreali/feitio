import { sql } from "drizzle-orm";
import {
	check,
	pgEnum,
	pgPolicy,
	pgTable,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { MembershipId, TenantId, UserId } from "../../domain/ids.js";
import { appRole } from "../roles.js";
import { currentUserId, tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/** `owner` manages the store; `staff` works in it. */
export const membershipRole = pgEnum("membership_role", ["owner", "staff"]);

export type MembershipRole = (typeof membershipRole.enumValues)[number];

/** A user's access to a tenant's admin panel, with a role. */
export const memberships = pgTable(
	"memberships",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<MembershipId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.$type<UserId>()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		role: membershipRole("role").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		unique("memberships_tenant_user_unique").on(
			table.tenantId,
			table.userId,
		),
		check(
			"memberships_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("memberships"),
		// Sign-in lists a user's tenants before any tenant is chosen. Policies
		// add up, so this only widens reads; writes stay within the tenant.
		pgPolicy("memberships_own_user_read", {
			for: "select",
			to: appRole,
			using: sql`user_id = ${currentUserId}`,
		}),
	],
).enableRLS();
