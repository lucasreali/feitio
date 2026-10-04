import {
	BadRequestException,
	type ExecutionContext,
	NotFoundException,
} from "@nestjs/common";
import { TenantGuard } from "./tenant.guard.js";
import type { CurrentTenant } from "./tenant-context.js";
import type { TenantResolver } from "./tenant-resolver.js";

const active: CurrentTenant = { id: crypto.randomUUID(), slug: "loja-aurora" };

const guardFor = (known: CurrentTenant | null) =>
	new TenantGuard({
		resolveActive: async (slug: string) =>
			slug === known?.slug ? known : null,
	} as TenantResolver);

const contextWith = (headers: Record<string, string>) => {
	const request: { headers: Record<string, string>; tenant?: CurrentTenant } =
		{ headers };
	const context = {
		switchToHttp: () => ({ getRequest: () => request }),
	} as unknown as ExecutionContext;
	return { request, context };
};

describe("TenantGuard", () => {
	it("puts the active tenant on the request", async () => {
		const { request, context } = contextWith({ "x-tenant": "loja-aurora" });
		await expect(guardFor(active).canActivate(context)).resolves.toBe(true);
		expect(request.tenant).toEqual(active);
	});

	it("answers 400 without the header", async () => {
		const { context } = contextWith({});
		await expect(
			guardFor(active).canActivate(context),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it("answers the same 404 for unknown and inactive tenants", async () => {
		const unknown = guardFor(active).canActivate(
			contextWith({ "x-tenant": "nao-existe" }).context,
		);
		const inactive = guardFor(null).canActivate(
			contextWith({ "x-tenant": "loja-aurora" }).context,
		);
		await expect(unknown).rejects.toBeInstanceOf(NotFoundException);
		await expect(inactive).rejects.toBeInstanceOf(NotFoundException);
		await expect(unknown).rejects.toThrow("Tenant not found");
		await expect(inactive).rejects.toThrow("Tenant not found");
	});
});
