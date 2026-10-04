import { randomUUID } from "node:crypto";
import { type Brand, brandedString } from "../domain/brand.js";
import { TenantId } from "../domain/ids.js";

const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSION = /^\.[a-z0-9]{1,10}$/;
const OBJECT_KEY =
	/^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/;

/** A key built by `buildObjectKey`: `tenants/{tenantId}/{category}/{uuid}{ext}`. */
export type ObjectKey = Brand<string, "ObjectKey">;
export const ObjectKey = brandedString("ObjectKey", (value) =>
	OBJECT_KEY.test(value),
);

/** `tenants/{tenantId}/`, the prefix that holds every file of a tenant. */
export function tenantPrefix(tenantId: TenantId): string {
	// Checked again at runtime: the id becomes a path inside the bucket.
	return `tenants/${TenantId.parse(tenantId)}/`;
}

/**
 * `tenants/{tenantId}/{category}/{random id}{extension}`. The extension comes
 * from the validated content type (see resolveFileType), never from the caller.
 *
 * Domain types: `category` stays a string. Its values come from code
 * ("products", "invoices") and are checked here; a type would only add a
 * parse call at every caller. The file name is a random UUID v4, not a v7:
 * it is not an entity id, and its 122 random bits keep public file URLs
 * unguessable.
 */
export function buildObjectKey(
	tenantId: TenantId,
	category: string,
	extension: string,
): ObjectKey {
	if (!CATEGORY.test(category)) {
		throw new Error(
			`Invalid file category: "${category}". Use lowercase letters, digits and dashes.`,
		);
	}
	if (!EXTENSION.test(extension)) {
		throw new Error(`Invalid file extension: "${extension}"`);
	}
	return ObjectKey.parse(
		`${tenantPrefix(tenantId)}${category}/${randomUUID()}${extension}`,
	);
}
