import { type Brand, brandedString } from "./brand.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LENGTH = 63;

/** A tenant's public identifier, used in URLs and in the X-Tenant header. */
export type TenantSlug = Brand<string, "TenantSlug">;
export const TenantSlug = brandedString(
	"TenantSlug",
	(value) => value.length <= MAX_LENGTH && SLUG.test(value),
);
