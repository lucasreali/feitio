import { TenantContext } from "./tenant-context.js";

const tenantA = { id: "00000000-0000-4000-8000-00000000000a", slug: "a" };
const tenantB = { id: "00000000-0000-4000-8000-00000000000b", slug: "b" };

describe("TenantContext", () => {
	it("has no tenant outside a run", () => {
		expect(TenantContext.current()).toBeUndefined();
	});

	it("keeps the tenant across awaits inside a run", async () => {
		const seen = await TenantContext.run(tenantA, async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return TenantContext.current();
		});
		expect(seen).toEqual(tenantA);
		expect(TenantContext.current()).toBeUndefined();
	});

	it("keeps concurrent runs apart", async () => {
		const slow = (tenant: typeof tenantA, ms: number) =>
			TenantContext.run(tenant, async () => {
				await new Promise((resolve) => setTimeout(resolve, ms));
				return TenantContext.current()?.slug;
			});
		await expect(
			Promise.all([slow(tenantA, 10), slow(tenantB, 1)]),
		).resolves.toEqual(["a", "b"]);
	});
});
