import { createHash, randomBytes } from "node:crypto";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Valkey } from "../valkey/valkey.js";
import { SESSION_CONFIG, type SessionConfig } from "./session.config.js";

/** What a session stores. The cookie only carries a random token. */
export interface Session {
	userId: string;
	tenantId: string;
	/** ISO 8601 timestamps. */
	createdAt: string;
	lastUsedAt: string;
}

export interface NewSession {
	userId: string;
	tenantId: string;
}

declare module "fastify" {
	interface FastifyRequest {
		/** Set by SessionGuard on protected routes. */
		authSession?: Session;
	}
}

/**
 * Cookie sessions stored in Valkey. The cookie holds a signed random token;
 * Valkey keys use the token's SHA-256, so reading Valkey never yields a
 * usable cookie. Each use renews the expiration (sliding sessions).
 */
@Injectable()
export class SessionService {
	constructor(
		private readonly valkey: Valkey,
		@Inject(SESSION_CONFIG) private readonly config: SessionConfig,
	) {}

	/** Starts a session and sets its cookie on the reply. */
	async create(reply: FastifyReply, owner: NewSession): Promise<Session> {
		const token = randomBytes(32).toString("base64url");
		const now = new Date().toISOString();
		const session: Session = { ...owner, createdAt: now, lastUsedAt: now };
		await this.save(hashToken(token), session);
		this.setCookie(reply, token);
		return session;
	}

	/**
	 * The session behind the request's cookie, or null when the cookie is
	 * missing, tampered with, unknown or expired. A valid session is renewed.
	 */
	async readFromCookie(
		request: FastifyRequest,
		reply: FastifyReply,
	): Promise<Session | null> {
		const token = this.tokenFromCookie(request);
		if (!token) {
			return null;
		}
		const hash = hashToken(token);
		const stored = await this.valkey.get(sessionKey(hash));
		if (!stored) {
			return null;
		}
		const session: Session = {
			...(JSON.parse(stored) as Session),
			lastUsedAt: new Date().toISOString(),
		};
		// XX: renew only if the session still exists. A destroy() or
		// destroyAllForUser() that ran after the GET above must win; a plain SET
		// would bring the ended session back.
		const ttl = this.config.ttlSeconds;
		const [[, renewed]] = (await this.valkey
			.multi()
			.set(sessionKey(hash), JSON.stringify(session), "EX", ttl, "XX")
			.expire(userSessionsKey(session.userId), ttl)
			.exec()) as [[Error | null, "OK" | null], unknown];
		if (renewed !== "OK") {
			return null;
		}
		this.setCookie(reply, token);
		return session;
	}

	/** Ends the request's session, if any, and clears its cookie. */
	async destroy(request: FastifyRequest, reply: FastifyReply): Promise<void> {
		const token = this.tokenFromCookie(request);
		if (token) {
			const hash = hashToken(token);
			const stored = await this.valkey.get(sessionKey(hash));
			const transaction = this.valkey.multi().del(sessionKey(hash));
			if (stored) {
				const { userId } = JSON.parse(stored) as Session;
				transaction.srem(userSessionsKey(userId), hash);
			}
			await transaction.exec();
		}
		reply.clearCookie(this.config.cookieName, this.cookieScope());
	}

	/** Ends every session of a user. Returns how many were still active. */
	async destroyAllForUser(userId: string): Promise<number> {
		const hashes = await this.valkey.smembers(userSessionsKey(userId));
		if (hashes.length === 0) {
			return 0;
		}
		const [[, deleted]] = (await this.valkey
			.multi()
			.del(...hashes.map(sessionKey))
			.del(userSessionsKey(userId))
			.exec()) as [[Error | null, number], unknown];
		return deleted;
	}

	private async save(hash: string, session: Session) {
		const ttl = this.config.ttlSeconds;
		// The user index lives as long as the user's most recently used session.
		await this.valkey
			.multi()
			.set(sessionKey(hash), JSON.stringify(session), "EX", ttl)
			.sadd(userSessionsKey(session.userId), hash)
			.expire(userSessionsKey(session.userId), ttl)
			.exec();
	}

	private tokenFromCookie(request: FastifyRequest): string | null {
		const signed = request.cookies[this.config.cookieName];
		if (!signed) {
			return null;
		}
		const { valid, value } = request.unsignCookie(signed);
		return valid && value ? value : null;
	}

	private setCookie(reply: FastifyReply, token: string) {
		reply.setCookie(this.config.cookieName, token, {
			...this.cookieScope(),
			httpOnly: true,
			secure: this.config.secure,
			sameSite: "lax",
			maxAge: this.config.ttlSeconds,
			signed: true,
		});
	}

	private cookieScope(): CookieSerializeOptions {
		return { path: "/", domain: this.config.cookieDomain };
	}
}

const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("hex");
const sessionKey = (hash: string) => `session:${hash}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;
