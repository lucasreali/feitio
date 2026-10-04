import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantId } from "../domain/ids.js";
import type { TenantSlug } from "../domain/tenant-slug.js";

/** The tenant a request belongs to. */
export interface CurrentTenant {
	id: TenantId;
	slug: TenantSlug;
}

const storage = new AsyncLocalStorage<CurrentTenant>();

/**
 * The current request's tenant, available anywhere down the call chain
 * without passing it around. Set by @TenantScoped() routes.
 */
export const TenantContext = {
	run<T>(tenant: CurrentTenant, fn: () => T): T {
		return storage.run(tenant, fn);
	},

	current(): CurrentTenant | undefined {
		return storage.getStore();
	},

	/** The current tenant's id, for rows the API writes. Throws outside a tenant context. */
	id(): TenantId {
		const tenant = storage.getStore();
		if (!tenant) {
			throw new Error(
				"No tenant context: call it from a @TenantScoped() or @PanelScoped() route.",
			);
		}
		return tenant.id;
	},
};
