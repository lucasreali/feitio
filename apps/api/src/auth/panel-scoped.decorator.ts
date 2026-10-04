import {
	applyDecorators,
	SetMetadata,
	UseGuards,
	UseInterceptors,
} from "@nestjs/common";
import {
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { MembershipRole } from "../database/schemas/memberships.js";
import { SessionGuard } from "../session/session.guard.js";
import { TenantContextInterceptor } from "../tenancy/tenant-context.interceptor.js";
import { PANEL_ROLE, PanelGuard } from "./panel.guard.js";

/** Name of the session cookie scheme in the OpenAPI document. */
export const SESSION_SECURITY = "session";

/**
 * Marks an admin panel route: it requires a session (and a CSRF token on
 * data-changing methods), a membership in the session's active tenant and,
 * when given, that role. The handler runs in TenantContext with the
 * session's tenant, so TenantDatabase.run sees only its rows.
 */
export const PanelScoped = (role?: MembershipRole) =>
	applyDecorators(
		SetMetadata(PANEL_ROLE, role),
		UseGuards(SessionGuard, PanelGuard),
		UseInterceptors(TenantContextInterceptor),
		ApiCookieAuth(SESSION_SECURITY),
		ApiUnauthorizedResponse({
			description: "No valid session, or no access to its tenant.",
		}),
		ApiForbiddenResponse({
			description: role
				? `Invalid CSRF token, or the user is not ${role}.`
				: "Invalid CSRF token.",
		}),
	);
