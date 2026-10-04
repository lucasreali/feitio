import { assertObjectKey, buildObjectKey, tenantPrefix } from "./object-key.js";

const tenantId = "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21";

describe("buildObjectKey", () => {
	it("builds tenants/{tenant}/{category}/{random id}{extension}", () => {
		const key = buildObjectKey(tenantId, "products", ".png");
		expect(key).toMatch(
			new RegExp(`^tenants/${tenantId}/products/[0-9a-f-]{36}\\.png$`),
		);
		expect(() => assertObjectKey(key)).not.toThrow();
	});

	it("generates a new name on every call", () => {
		expect(buildObjectKey(tenantId, "products", ".png")).not.toBe(
			buildObjectKey(tenantId, "products", ".png"),
		);
	});

	it.each([
		["../other-tenant", "products", ".png"],
		[tenantId, "../invoices", ".png"],
		[tenantId, "Products", ".png"],
		[tenantId, "products/x", ".png"],
		[tenantId, "", ".png"],
		[tenantId, "products", ""],
		[tenantId, "products", ".p<h>p"],
		[tenantId, "products", "/../x.png"],
	])(
		"rejects tenant %s, category %s and extension %s",
		(tenant, category, extension) => {
			expect(() => buildObjectKey(tenant, category, extension)).toThrow();
		},
	);
});

describe("tenantPrefix", () => {
	it("rejects anything that is not a tenant id", () => {
		expect(tenantPrefix(tenantId)).toBe(`tenants/${tenantId}/`);
		expect(() => tenantPrefix("")).toThrow();
		expect(() => tenantPrefix("../..")).toThrow();
	});
});

describe("assertObjectKey", () => {
	it.each([
		"tenants/x/products/a.png",
		`tenants/${tenantId}/products/../../secret.pdf`,
		`tenants/${tenantId}/products/my-file.png`,
		`tenants/${tenantId}/products/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21`,
		"other/path.png",
	])("rejects %s", (key) => {
		expect(() => assertObjectKey(key)).toThrow();
	});
});
