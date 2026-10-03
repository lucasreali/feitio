import { assertObjectKey, buildObjectKey, tenantPrefix } from "./object-key.js";

const tenantId = "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21";

describe("buildObjectKey", () => {
	it("builds tenants/{tenant}/{category}/{random id}{extension}", () => {
		const key = buildObjectKey(tenantId, "products", "Foto Produto.PNG");
		expect(key).toMatch(
			new RegExp(`^tenants/${tenantId}/products/[0-9a-f-]{36}\\.png$`),
		);
		expect(() => assertObjectKey(key)).not.toThrow();
	});

	it("generates a new name on every call", () => {
		expect(buildObjectKey(tenantId, "products", "a.png")).not.toBe(
			buildObjectKey(tenantId, "products", "a.png"),
		);
	});

	it("drops missing or unusual extensions", () => {
		expect(buildObjectKey(tenantId, "docs", "README")).toMatch(
			/\/[0-9a-f-]{36}$/,
		);
		expect(buildObjectKey(tenantId, "docs", "x.p<h>p")).toMatch(
			/\/[0-9a-f-]{36}$/,
		);
	});

	it.each([
		["../other-tenant", "products"],
		[tenantId, "../invoices"],
		[tenantId, "Products"],
		[tenantId, "products/x"],
		[tenantId, ""],
	])("rejects tenant %s with category %s", (tenant, category) => {
		expect(() => buildObjectKey(tenant, category, "a.png")).toThrow();
	});
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
		"other/path.png",
	])("rejects %s", (key) => {
		expect(() => assertObjectKey(key)).toThrow();
	});
});
