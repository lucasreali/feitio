import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { changesData, hasValidCsrfToken } from "./csrf.js";
import { SessionService } from "./session.service.js";

/**
 * Requires a valid session cookie. Missing, tampered, unknown or expired
 * sessions get a generic 401. Data-changing methods (POST, PUT, PATCH,
 * DELETE) also need a valid CSRF token (`x-csrf-token`, from GET /csrf-token),
 * or get 403. Read the session with @CurrentSession().
 */
@Injectable()
export class SessionGuard implements CanActivate {
	constructor(private readonly sessions: SessionService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const http = context.switchToHttp();
		const request = http.getRequest<FastifyRequest>();
		const reply = http.getResponse<FastifyReply>();
		const session = await this.sessions.readFromCookie(request, reply);
		if (!session) {
			throw new UnauthorizedException();
		}
		if (
			changesData(request) &&
			!(await hasValidCsrfToken(request, reply))
		) {
			throw new ForbiddenException("Invalid CSRF token");
		}
		request.authSession = session;
		return true;
	}
}
