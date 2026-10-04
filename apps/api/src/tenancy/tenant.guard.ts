import {
	BadRequestException,
	type CanActivate,
	type ExecutionContext,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { CurrentTenant } from "./tenant-context.js";
import { TenantResolver } from "./tenant-resolver.js";

/** Header carrying the tenant's public identifier (its slug). */
export const TENANT_HEADER = "x-tenant";

declare module "fastify" {
	interface FastifyRequest {
		/** Set by TenantGuard on @TenantScoped() routes. */
		tenant?: CurrentTenant;
	}
}

/**
 * Resolves the X-Tenant header to an active tenant. Missing header: 400.
 * Unknown or inactive tenant: the same 404, so callers cannot tell whether a
 * tenant exists.
 */
@Injectable()
export class TenantGuard implements CanActivate {
	constructor(private readonly resolver: TenantResolver) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<FastifyRequest>();
		const header = request.headers[TENANT_HEADER];
		const slug = Array.isArray(header) ? header[0] : header;
		if (!slug) {
			throw new BadRequestException("The X-Tenant header is required");
		}
		const tenant = await this.resolver.resolveActive(slug.trim());
		if (!tenant) {
			throw new NotFoundException("Tenant not found");
		}
		request.tenant = tenant;
		return true;
	}
}
