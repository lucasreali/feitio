import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { MembershipRole } from "../database/schemas/memberships.js";
import { MembershipsRepository } from "./memberships.repository.js";

/** Metadata key for the role a panel route requires. */
export const PANEL_ROLE = "panel-role";

/**
 * Runs after SessionGuard on admin panel routes. Checks on every request
 * that the session's user is still a member of the session's tenant and that
 * the tenant is active (401 otherwise), and that the member has the route's
 * role (403). Then sets `request.tenant` for TenantContextInterceptor.
 */
@Injectable()
export class PanelGuard implements CanActivate {
	constructor(
		private readonly memberships: MembershipsRepository,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<FastifyRequest>();
		const session = request.authSession;
		if (!session) {
			throw new Error("PanelGuard needs SessionGuard to run first");
		}
		const membership = await this.memberships.findActive(
			session.userId,
			session.tenantId,
		);
		if (!membership) {
			throw new UnauthorizedException();
		}
		const role = this.reflector.get<MembershipRole | undefined>(
			PANEL_ROLE,
			context.getHandler(),
		);
		if (role && membership.role !== role) {
			throw new ForbiddenException();
		}
		request.tenant = { id: membership.tenantId, slug: membership.slug };
		return true;
	}
}
