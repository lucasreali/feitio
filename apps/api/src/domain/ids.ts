import { type Brand, brandedString } from "./brand.js";
import { isUuidV7, uuidv7 } from "./uuid-v7.js";

/**
 * Entity ids are UUID v7 (time-ordered). The database generates them by
 * default with uuid_generate_v7() and refuses other versions on new rows.
 */
const entityId = <Name extends string>(name: Name) => {
	const parser = brandedString(name, isUuidV7);
	return {
		...parser,
		/** A new id, for rows the API creates with a known id. */
		generate: () => parser.parse(uuidv7()),
	};
};

/** Id of a tenant (a merchant). */
export type TenantId = Brand<string, "TenantId">;
export const TenantId = entityId("TenantId");

/** Id of a user of the admin panel. */
export type UserId = Brand<string, "UserId">;
export const UserId = entityId("UserId");

/** Id of a membership: a user's access to a tenant, with a role. */
export type MembershipId = Brand<string, "MembershipId">;
export const MembershipId = entityId("MembershipId");
