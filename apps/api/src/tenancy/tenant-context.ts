import { AsyncLocalStorage } from "node:async_hooks";

/** The tenant a request belongs to. */
export interface CurrentTenant {
	id: string;
	slug: string;
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
};
