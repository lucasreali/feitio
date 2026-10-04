import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Session } from "./session.service.js";

/** The current session, on routes protected by SessionGuard. */
export const CurrentSession = createParamDecorator(
	(_data: unknown, context: ExecutionContext): Session | undefined =>
		context.switchToHttp().getRequest<FastifyRequest>().authSession,
);
