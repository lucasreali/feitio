import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import {
	type MembershipRole,
	memberships,
} from "../database/schemas/memberships.js";
import { tenants } from "../database/schemas/tenants.js";
import type { TenantId, UserId } from "../domain/ids.js";
import type { TenantSlug } from "../domain/tenant-slug.js";

/** A user's access to an active tenant. */
export interface ActiveMembership {
	tenantId: TenantId;
	slug: TenantSlug;
	name: string;
	role: MembershipRole;
}

/**
 * Reads a user's memberships before a tenant is chosen. Each call runs in a
 * transaction with `app.user_id` set, so RLS (memberships_own_user_read)
 * shows only that user's rows.
 */
@Injectable()
export class MembershipsRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/** The user's memberships in active tenants, oldest first. */
	listActive(userId: UserId): Promise<ActiveMembership[]> {
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('app.user_id', ${userId}, true)`,
			);
			return tx
				.select({
					tenantId: memberships.tenantId,
					slug: tenants.slug,
					name: tenants.name,
					role: memberships.role,
				})
				.from(memberships)
				.innerJoin(tenants, eq(tenants.id, memberships.tenantId))
				.where(
					and(
						eq(memberships.userId, userId),
						eq(tenants.status, "active"),
					),
				)
				.orderBy(memberships.createdAt);
		});
	}

	/** The user's membership in `tenantId`, or null when absent or the tenant is inactive. */
	async findActive(
		userId: UserId,
		tenantId: TenantId,
	): Promise<ActiveMembership | null> {
		const all = await this.listActive(userId);
		return (
			all.find((membership) => membership.tenantId === tenantId) ?? null
		);
	}
}
