import { TenantId } from "../domain/ids.js";
import { buildObjectKey, ObjectKey, tenantPrefix } from "./object-key.js";

const tenantId = TenantId.generate();
// A value forced into the type, as a cast or a corrupted database row would.
const forcedTenant = (value: string) => value as TenantId;

describe("buildObjectKey", () => {
	it("builds tenants/{tenant}/{category}/{random id}{extension}", () => {
		const key = buildObjectKey(tenantId, "products", ".png");
		expect(key).toMatch(
			new RegExp(`^tenants/${tenantId}/products/[0-9a-f-]{36}\\.png$`),
		);
		expect(ObjectKey.parse(key)).toBe(key);
	});

	it("generates a new name on every call", () => {
		expect(buildObjectKey(tenantId, "products", ".png")).not.toBe(
			buildObjectKey(tenantId, "products", ".png"),
		);
	});

	it.each([
		[forcedTenant("../other-tenant"), "products", ".png"],
		[
			forcedTenant("0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21"),
			"products",
			".png",
		],
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
	it("refuses anything that is not a tenant id, even when forced into the type", () => {
		expect(tenantPrefix(tenantId)).toBe(`tenants/${tenantId}/`);
		expect(() => tenantPrefix(forcedTenant(""))).toThrow();
		expect(() => tenantPrefix(forcedTenant("../.."))).toThrow();
	});
});

describe("ObjectKey", () => {
	it.each([
		"tenants/x/products/a.png",
		`tenants/${tenantId}/products/../../secret.pdf`,
		`tenants/${tenantId}/products/my-file.png`,
		`tenants/${tenantId}/products/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21`,
		"tenants/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21/products/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b22.png",
		"other/path.png",
	])("rejects %s", (key) => {
		expect(() => ObjectKey.parse(key)).toThrow("Invalid ObjectKey");
		expect(ObjectKey.tryParse(key)).toBeNull();
	});
});
