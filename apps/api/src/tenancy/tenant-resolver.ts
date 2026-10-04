import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { tenants } from "../database/schemas/tenants.js";
import type { CurrentTenant } from "./tenant-context.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Finds the active tenant behind a public identifier (its slug). */
@Injectable()
export class TenantResolver {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/** The active tenant with this slug, or null for unknown or inactive ones. */
	async resolveActive(slug: string): Promise<CurrentTenant | null> {
		if (slug.length > 63 || !SLUG.test(slug)) {
			return null;
		}
		const [tenant] = await this.db
			.select({ id: tenants.id, slug: tenants.slug })
			.from(tenants)
			.where(and(eq(tenants.slug, slug), eq(tenants.status, "active")))
			.limit(1);
		return tenant ?? null;
	}
}
