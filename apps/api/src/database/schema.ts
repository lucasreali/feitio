import { assets } from "./schemas/assets.js";
import { memberships } from "./schemas/memberships.js";
import { storeSettings } from "./schemas/store-settings.js";
import { tenants } from "./schemas/tenants.js";
import { users } from "./schemas/users.js";

/** Every table of the system, passed to the Drizzle client. One file per table in `schemas/`. */
export const schemas = {
	tenants,
	storeSettings,
	users,
	memberships,
	assets,
};
