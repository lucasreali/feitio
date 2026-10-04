import { TenantSlug } from "./tenant-slug.js";

describe("TenantSlug", () => {
	it.each(["loja-aurora", "loja2", "a", "a".repeat(63)])(
		"accepts %j",
		(value) => {
			expect(TenantSlug.parse(value)).toBe(value);
			expect(TenantSlug.tryParse(value)).toBe(value);
		},
	);

	it.each([
		["uppercase", "Loja-Aurora"],
		["spaces", "loja aurora"],
		["leading dash", "-loja"],
		["trailing dash", "loja-"],
		["double dash", "loja--aurora"],
		["SQL", "x' or '1'='1"],
		["path", "../loja"],
		["empty", ""],
		["longer than 63 characters", "a".repeat(64)],
	])("refuses a slug with %s", (_case, value) => {
		expect(() => TenantSlug.parse(value)).toThrow("Invalid TenantSlug");
		expect(TenantSlug.tryParse(value)).toBeNull();
	});
});
