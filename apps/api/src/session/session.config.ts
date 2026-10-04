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

const DEFAULT_COOKIE_NAME = "feitio_session";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

const fail = (message: string): never => {
	throw new Error(
		`${message} Copy apps/api/.env.example to apps/api/.env or set it in the environment.`,
	);
};

/** Reads and validates the session settings from the environment. */
export function readSessionConfig(): SessionConfig {
	const env = process.env;
	const cookieSecret = env.COOKIE_SECRET ?? fail("COOKIE_SECRET is not set.");
	if (cookieSecret.length < MIN_SECRET_LENGTH) {
		fail(
			`COOKIE_SECRET must have at least ${MIN_SECRET_LENGTH} characters.`,
		);
	}

	const ttlSeconds = env.SESSION_TTL_SECONDS
		? Number(env.SESSION_TTL_SECONDS)
		: DEFAULT_TTL_SECONDS;
	if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
		fail("SESSION_TTL_SECONDS must be a positive whole number of seconds.");
	}

	return {
		cookieSecret,
		cookieName: env.SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME,
		cookieDomain: env.SESSION_COOKIE_DOMAIN || undefined,
		ttlSeconds,
		secure: env.NODE_ENV === "production",
	};
}
