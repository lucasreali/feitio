import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
	type CurrentCustomerSession,
	CustomerSessions,
} from "./customer-sessions.js";

declare module "fastify" {
	interface FastifyRequest {
		/** Set by CustomerGuard on @CustomerScoped() routes. */
		customerSession?: CurrentCustomerSession;
	}
}

const BEARER = /^Bearer ([\w-]{1,128})$/;

/**
 * Runs after TenantGuard on a buyer's routes: requires a token
 * (`Authorization: Bearer`) of a session in the request's store. A missing,
 * unknown or expired token, or one from another store, gets the same 401.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
	constructor(private readonly sessions: CustomerSessions) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<FastifyRequest>();
		if (!request.tenant) {
			throw new Error("CustomerGuard needs TenantGuard to run first");
		}
		const token = BEARER.exec(request.headers.authorization ?? "")?.[1];
		const session = token && (await this.sessions.read(token));
		if (!session || session.tenantId !== request.tenant.id) {
			throw new UnauthorizedException();
		}
		request.customerSession = session;
		return true;
	}
}
