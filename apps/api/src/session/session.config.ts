import { configOf } from "../config/config.js";

export const SESSION_CONFIG = Symbol("SESSION_CONFIG");

export interface SessionConfig {
	/** Secret that signs cookies (COOKIE_SECRET, at least 32 characters). */
	cookieSecret: string;
	cookieName: string;
	/** Optional cookie domain; when absent the cookie belongs to the API host only. */
	cookieDomain: string | undefined;
	/** Sessions expire after this many seconds without use. */
	ttlSeconds: number;
	/** Cookies only travel over HTTPS. On in production. */
	secure: boolean;
}

/** The session settings, validated (see `src/config/config.ts`). */
export const readSessionConfig = (): SessionConfig => configOf("session");
