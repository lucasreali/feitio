import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CsrfTokenDto } from "./csrf-token.dto.js";

@Controller("csrf-token")
export class CsrfController {
	/**
	 * Issues a CSRF token for session-protected requests. Also sets the signed
	 * cookie that holds the CSRF secret, so call it with credentials.
	 */
	@Get()
	token(@Res({ passthrough: true }) reply: FastifyReply): CsrfTokenDto {
		return { token: reply.generateCsrf() };
	}
}
