import {
	BadRequestException,
	Body,
	Controller,
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
import { CurrentSession } from "../session/current-session.decorator.js";
import { SessionGuard } from "../session/session.guard.js";
import { type Session, SessionService } from "../session/session.service.js";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./login.dto.js";
import { MeDto } from "./me.dto.js";
import { toMeDto } from "./me.mapper.js";
import { SESSION_SECURITY } from "./panel-scoped.decorator.js";

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
