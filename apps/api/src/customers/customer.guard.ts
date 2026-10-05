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
 * The buyer's session behind the request's `Authorization: Bearer` token:
 * undefined without the header; null for a missing, unknown or expired
 * token, or one from another store.
 */
export async function readCustomerSession(
	request: FastifyRequest,
	sessions: CustomerSessions,
): Promise<CurrentCustomerSession | null | undefined> {
	if (!request.tenant) {
		throw new Error("Reading a buyer's session needs TenantGuard first");
	}
	if (request.headers.authorization === undefined) {
		return undefined;
	}
	const token = BEARER.exec(request.headers.authorization)?.[1];
	const session = token && (await sessions.read(token));
	return session && session.tenantId === request.tenant.id ? session : null;
}

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
		const session = await readCustomerSession(request, this.sessions);
		if (!session) {
			throw new UnauthorizedException();
		}
		request.customerSession = session;
		return true;
	}
}
