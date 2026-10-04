import { createHmac } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "./session.service.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether the request method can change data, and so needs a CSRF token. */
export const changesData = (request: FastifyRequest) =>
	!SAFE_METHODS.has(request.method);

/**
 * Runs @fastify/csrf-protection's own check (secret cookie + `x-csrf-token`).
 * The plugin is built as an onRequest hook that answers failures with
 * `reply.send(error)`; a reply proxy turns that into `false` so the caller
 * can throw a Nest exception instead.
 */
export function hasValidCsrfToken(
	request: FastifyRequest,
	reply: FastifyReply,
): Promise<boolean> {
	return new Promise((resolve) => {
		const capture: FastifyReply = Object.create(reply, {
			send: { value: () => resolve(false) },
		});
		request.server.csrfProtection(request, capture, () => resolve(true));
	});
}

/**
 * Binds CSRF tokens to one session: a token only verifies for the session
 * it was issued to, so a CSRF secret planted from elsewhere is useless.
 */
export const csrfSessionBinding = (session: Session) =>
	`${session.userId}:${session.createdAt}`;

/** HMAC key for session-bound tokens, derived from COOKIE_SECRET. */
export const csrfHmacKey = (cookieSecret: string) =>
	createHmac("sha256", cookieSecret)
		.update("csrf-session-binding")
		.digest("hex");
