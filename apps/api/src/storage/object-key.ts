import { randomUUID } from "node:crypto";
import { extname } from "node:path";

const TENANT_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSION = /^\.[a-z0-9]{1,10}$/;
const OBJECT_KEY =
	/^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/;

/** `tenants/{tenantId}/`, the prefix that holds every file of a tenant. */
export function tenantPrefix(tenantId: string): string {
	if (!TENANT_ID.test(tenantId)) {
		throw new Error(`Invalid tenant id: "${tenantId}"`);
	}
	return `tenants/${tenantId}/`;
}

/**
 * `tenants/{tenantId}/{category}/{random id}{extension}`. Only the extension of
 * the original name is kept, lowercased; anything unusual is dropped.
 */
export function buildObjectKey(
	tenantId: string,
	category: string,
	fileName: string,
): string {
	if (!CATEGORY.test(category)) {
		throw new Error(
			`Invalid file category: "${category}". Use lowercase letters, digits and dashes.`,
		);
	}
	const extension = extname(fileName).toLowerCase();
	return `${tenantPrefix(tenantId)}${category}/${randomUUID()}${EXTENSION.test(extension) ? extension : ""}`;
}

/** Rejects keys that were not produced by `buildObjectKey`. */
export function assertObjectKey(key: string): void {
	if (!OBJECT_KEY.test(key)) {
		throw new Error(`Invalid file key: "${key}"`);
	}
}
