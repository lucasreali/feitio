import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { TenantContextInterceptor } from "./tenant-context.interceptor.js";
import { TenantContext } from "./tenant-context.js";

const contextWith = (tenant?: { id: string; slug: string }) =>
	({
		switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
	}) as unknown as ExecutionContext;

describe("TenantContextInterceptor", () => {
	const interceptor = new TenantContextInterceptor();

	it("runs the handler with the request's tenant in TenantContext", async () => {
		const tenant = { id: crypto.randomUUID(), slug: "loja-aurora" };
		const handler: CallHandler = {
			handle: () => of(TenantContext.current()),
		};

		await expect(
			firstValueFrom(interceptor.intercept(contextWith(tenant), handler)),
		).resolves.toEqual(tenant);
	});

	it("refuses to run when TenantGuard did not set a tenant", () => {
		const handler: CallHandler = { handle: () => of("ran") };
		expect(() => interceptor.intercept(contextWith(), handler)).toThrow(
			/needs TenantGuard/,
		);
	});
});
