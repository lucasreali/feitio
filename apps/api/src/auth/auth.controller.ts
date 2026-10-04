import {
	BadRequestException,
	Body,
	Controller,
	ForbiddenException,
	Get,
	HttpCode,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TenantId } from "../domain/ids.js";
import { CurrentSession } from "../session/current-session.decorator.js";
import { SessionGuard } from "../session/session.guard.js";
import { type Session, SessionService } from "../session/session.service.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";
import { MeDto } from "./me.dto.js";
import { toMeDto } from "./me.mapper.js";
import { PanelScoped, SESSION_SECURITY } from "./panel-scoped.decorator.js";
import { SwitchTenantDto } from "./switch-tenant.dto.js";

@Controller("auth")
export class AuthController {
	constructor(
		private readonly auth: AuthService,
		private readonly sessions: SessionService,
	) {}

	/**
	 * Signs in to the admin panel and starts a session (cookie) in the user's
	 * first active store. Wrong credentials and users without an active store
	 * get the same 401.
	 */
	@Post("login")
	@HttpCode(200)
	@ApiBadRequestResponse({ description: "E-mail or password missing." })
	@ApiUnauthorizedResponse({ description: "Invalid credentials." })
	async login(
		@Body() body: LoginDto,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<MeDto> {
		const { email, password } = body ?? {};
		if (typeof email !== "string" || typeof password !== "string") {
			throw new BadRequestException("email and password are required");
		}
		const found = await this.auth.authenticate(email, password);
		if (!found) {
			throw new UnauthorizedException();
		}
		const [active] = found.memberships;
		// A session already on this browser ends; the new one has a new token.
		await this.sessions.destroy(request, reply);
		await this.sessions.create(reply, {
			userId: found.user.id,
			tenantId: active.tenantId,
		});
		return toMeDto(found.user, active.tenantId, found.memberships);
	}

	/** The signed-in user, the store the session works in and every store they can open. */
	@Get("me")
	@PanelScoped()
	async me(@CurrentSession() session: Session): Promise<MeDto> {
		const found = await this.auth.load(session.userId);
		if (!found) {
			throw new UnauthorizedException();
		}
		return toMeDto(found.user, session.tenantId, found.memberships);
	}

	/**
	 * Moves the session to another of the user's active stores. The session
	 * is replaced: use the new cookie and fetch a new CSRF token.
	 */
	@Post("tenant")
	@HttpCode(200)
	@UseGuards(SessionGuard)
	@ApiCookieAuth(SESSION_SECURITY)
	@ApiBadRequestResponse({ description: "Missing or malformed tenantId." })
	@ApiUnauthorizedResponse({ description: "No valid session." })
	@ApiForbiddenResponse({
		description:
			"Invalid CSRF token, or not a member of that active store.",
	})
	async switchTenant(
		@Body() body: SwitchTenantDto,
		@CurrentSession() session: Session,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<MeDto> {
		const tenantId =
			typeof body?.tenantId === "string"
				? TenantId.tryParse(body.tenantId)
				: null;
		if (!tenantId) {
			throw new BadRequestException("tenantId must be a store id");
		}
		const found = await this.auth.load(session.userId);
		if (!found?.memberships.some((m) => m.tenantId === tenantId)) {
			throw new ForbiddenException("No access to this store");
		}
		await this.sessions.destroy(request, reply);
		await this.sessions.create(reply, { userId: session.userId, tenantId });
		return toMeDto(found.user, tenantId, found.memberships);
	}

	/** Ends the current session. */
	@Post("logout")
	@HttpCode(204)
	@UseGuards(SessionGuard)
	@ApiCookieAuth(SESSION_SECURITY)
	@ApiUnauthorizedResponse({ description: "No valid session." })
	@ApiForbiddenResponse({ description: "Invalid CSRF token." })
	async logout(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		await this.sessions.destroy(request, reply);
	}

	/** Ends every session of the user, on every device. */
	@Post("logout-all")
	@HttpCode(204)
	@UseGuards(SessionGuard)
	@ApiCookieAuth(SESSION_SECURITY)
	@ApiUnauthorizedResponse({ description: "No valid session." })
	@ApiForbiddenResponse({ description: "Invalid CSRF token." })
	async logoutAll(
		@CurrentSession() session: Session,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<void> {
		await this.sessions.destroyAllForUser(session.userId);
		await this.sessions.destroy(request, reply);
	}
}
