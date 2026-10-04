import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import { ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { csrfSessionBinding } from "./csrf.js";
import { CsrfTokenDto } from "./csrf-token.dto.js";
import { CurrentSession } from "./current-session.decorator.js";
import { SessionGuard } from "./session.guard.js";
import type { Session } from "./session.service.js";

@Controller("csrf-token")
export class CsrfController {
	/**
	 * Issues a CSRF token bound to the current session. Also sets the signed
	 * cookie that holds the CSRF secret, so call it with credentials.
	 */
	@Get()
	@UseGuards(SessionGuard)
	@ApiUnauthorizedResponse({ description: "No valid session." })
	token(
		@CurrentSession() session: Session,
		@Res({ passthrough: true }) reply: FastifyReply,
	): CsrfTokenDto {
		return {
			token: reply.generateCsrf({
				userInfo: csrfSessionBinding(session),
			}),
		};
	}
}
