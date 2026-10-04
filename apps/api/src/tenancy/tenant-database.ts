import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { TenantContext } from "./tenant-context.js";

/** A transaction bound to the current tenant, handed to repositories. */
export type TenantTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];

/**
 * The one way repositories query business tables. Each call runs in a
 * transaction that first tells PostgreSQL the current tenant
 * (`app.tenant_id`, transaction-local), so RLS limits every read and write to
 * that tenant's rows, with or without filters in the query.
 */
@Injectable()
export class TenantDatabase {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	run<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
		const tenant = TenantContext.current();
		if (!tenant) {
			throw new Error(
				"TenantDatabase.run needs a tenant context: call it from a @TenantScoped() route.",
			);
		}
		return this.db.transaction(async (tx) => {
			await tx.execute(
				sql`select set_config('app.tenant_id', ${tenant.id}, true)`,
			);
			return fn(tx);
		});
	}
}
