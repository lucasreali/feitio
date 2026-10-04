import type { Database } from "../database/database.js";
import { TenantResolver } from "./tenant-resolver.js";

describe("TenantResolver", () => {
	// Any query fails the test: malformed slugs must never reach the database.
	const untouchedDatabase = {
		select: () => {
			throw new Error("the database was queried");
		},
	} as unknown as Database;
	const resolver = new TenantResolver(untouchedDatabase);

	it.each([
		["uppercase", "Loja-Aurora"],
		["spaces", "loja aurora"],
		["leading dash", "-loja"],
		["double dash", "loja--aurora"],
		["SQL", "x' or '1'='1"],
		["path", "../loja"],
		["empty", ""],
		["longer than 63 characters", "a".repeat(64)],
	])(
		"returns null for a slug with %s, without querying",
		async (_case, slug) => {
			await expect(resolver.resolveActive(slug)).resolves.toBeNull();
		},
	);
});
