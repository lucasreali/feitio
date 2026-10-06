import { Email } from "../domain/email.js";
import type { SessionConfig } from "../session/session.config.js";

type Env = Record<string, string | undefined>;

/** The API's settings, typed and validated, by area. */
export interface AppConfig {
	server: { port: number };
	/** The API's user (`feitio_app`), which cannot bypass RLS. */
	database: { url: string };
	/** The owner of the tables, for the CLI; never the API's. */
	migrations: { url: string };
	storage: {
		endpoint: string;
		region: string;
		publicBucket: string;
		privateBucket: string;
		accessKeyId: string;
		secretAccessKey: string;
		publicUrl: string;
	};
	valkey: { url: string };
	session: SessionConfig;
	melhorEnvio: { url: string; token: string; userAgent: string };
	asaas: { url: string; apiKey: string; walletId: string };
	payments: {
		/** Feitio's part of every payment, in percent. */
		feePercent: number;
		/** Seals the stores' gateway keys: 32 bytes in base64. */
		secretKey: string;
		/** Where the gateway reaches the API, without the trailing slash. */
		publicApiUrl: string;
	};
	/** Sending e-mail (the worker only: every e-mail goes through the queue). */
	email: {
		resendApiKey: string;
		/** The address every store sends from, on Feitio's verified domain. */
		from: Email;
	};
}

export type ConfigSection = keyof AppConfig;

/** What the API process needs, in the order problems are listed. */
export const API_SECTIONS = [
	"server",
	"database",
	"storage",
	"valkey",
	"session",
	"melhorEnvio",
	"asaas",
	"payments",
] as const satisfies readonly ConfigSection[];

/** What the worker process needs: no HTTP, files, sessions or carriers. */
export const WORKER_SECTIONS = [
	"database",
	"valkey",
	"asaas",
	"payments",
	"email",
] as const satisfies readonly ConfigSection[];

const HOW_TO_FIX =
	"Copy apps/api/.env.example to apps/api/.env or set them in the environment.";

/** Values copied from .env.example that were never filled in. */
const PLACEHOLDER = /^replace-with|<[^<>]+>/;

const DEFAULT_PORT = 3000;
const DEFAULT_COOKIE_NAME = "feitio_session";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

/**
 * Reads the variables of each section, collecting every problem instead of
 * stopping at the first. A value with a problem reads as "" (or 0), which
 * nobody sees: readConfig throws when there is any.
 */
function reader(env: Env) {
	const problems: string[] = [];
	const production = env.NODE_ENV === "production";
	const fail = (message: string) => {
		problems.push(message);
		return "";
	};
	/** Set, not empty, and not the example's placeholder. */
	const required = (name: string): string => {
		const value = env[name];
		if (!value) {
			return fail(`${name} is missing.`);
		}
		return PLACEHOLDER.test(value)
			? fail(`${name} still has the example's placeholder.`)
			: value;
	};
	/** An optional variable; empty counts as unset. */
	const optional = (name: string) => env[name] || undefined;
	const url = (name: string, protocols: string[], expected: string) => {
		const value = required(name);
		if (!value) {
			return "";
		}
		const parsed = URL.canParse(value) ? new URL(value) : null;
		return parsed && protocols.includes(parsed.protocol)
			? value
			: fail(`${name} must be ${expected}.`);
	};
	const http = (name: string) =>
		url(name, ["http:", "https:"], "an http(s) URL");
	/** An http(s) URL that, in production, is not the vendor's sandbox. */
	const vendorUrl = (name: string) => {
		const value = http(name);
		return production &&
			value &&
			new URL(value).hostname.includes("sandbox")
			? fail(`${name} must not be a sandbox in production.`)
			: value;
	};
	const whole = (
		name: string,
		fallback: number,
		valid: (n: number) => boolean,
		expected: string,
	) => {
		const value = optional(name);
		const n = value === undefined ? fallback : Number(value);
		if (Number.isInteger(n) && valid(n)) {
			return n;
		}
		fail(`${name} must be ${expected}.`);
		return 0;
	};

	const email = (name: string) => {
		const value = required(name);
		if (!value) {
			return value as Email;
		}
		return (
			Email.tryParse(value) ??
			(fail(`${name} must be an e-mail address.`) as Email)
		);
	};

	const sections: { [S in ConfigSection]: () => AppConfig[S] } = {
		server: () => ({
			port: whole(
				"PORT",
				DEFAULT_PORT,
				(n) => n >= 1 && n <= 65535,
				"a port from 1 to 65535",
			),
		}),
		database: () => ({
			url: url(
				"DATABASE_URL",
				["postgres:", "postgresql:"],
				"a postgresql:// URL",
			),
		}),
		migrations: () => ({
			url: url(
				"MIGRATION_DATABASE_URL",
				["postgres:", "postgresql:"],
				"a postgresql:// URL",
			),
		}),
		storage: () => ({
			endpoint: http("STORAGE_ENDPOINT"),
			region: required("STORAGE_REGION"),
			publicBucket: required("STORAGE_PUBLIC_BUCKET"),
			privateBucket: required("STORAGE_PRIVATE_BUCKET"),
			accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
			secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
			publicUrl: http("STORAGE_PUBLIC_URL"),
		}),
		valkey: () => ({
			url: url(
				"VALKEY_URL",
				["redis:", "rediss:"],
				"a redis:// or rediss:// URL",
			),
		}),
		session: () => {
			const cookieSecret = required("COOKIE_SECRET");
			if (cookieSecret && cookieSecret.length < MIN_SECRET_LENGTH) {
				fail(
					`COOKIE_SECRET must have at least ${MIN_SECRET_LENGTH} characters.`,
				);
			}
			return {
				cookieSecret,
				cookieName:
					optional("SESSION_COOKIE_NAME") ?? DEFAULT_COOKIE_NAME,
				cookieDomain: optional("SESSION_COOKIE_DOMAIN"),
				ttlSeconds: whole(
					"SESSION_TTL_SECONDS",
					DEFAULT_TTL_SECONDS,
					(n) => n > 0,
					"a positive whole number of seconds",
				),
				secure: production,
			};
		},
		melhorEnvio: () => ({
			url: vendorUrl("MELHOR_ENVIO_URL"),
			token: required("MELHOR_ENVIO_TOKEN"),
			userAgent: required("MELHOR_ENVIO_USER_AGENT"),
		}),
		asaas: () => ({
			url: vendorUrl("ASAAS_URL"),
			apiKey: required("ASAAS_API_KEY"),
			walletId: required("ASAAS_WALLET_ID"),
		}),
		payments: () => {
			const fee = required("PAYMENT_FEE_PERCENT");
			const feePercent = Number(fee);
			if (
				fee &&
				!(fee.trim() !== "" && feePercent >= 0 && feePercent < 100)
			) {
				fail("PAYMENT_FEE_PERCENT must be a percent from 0 to 99.99.");
			}
			const secretKey = required("PAYMENT_SECRET_KEY");
			if (secretKey && Buffer.from(secretKey, "base64").length !== 32) {
				fail("PAYMENT_SECRET_KEY must be 32 random bytes in base64.");
			}
			const publicApiUrl = http("PUBLIC_API_URL");
			if (
				production &&
				publicApiUrl &&
				!publicApiUrl.startsWith("https:")
			) {
				fail("PUBLIC_API_URL must be an https URL in production.");
			}
			return {
				feePercent,
				secretKey,
				publicApiUrl: publicApiUrl.replace(/\/$/, ""),
			};
		},
		email: () => ({
			resendApiKey: required("RESEND_API_KEY"),
			from: email("EMAIL_FROM"),
		}),
	};
	return { sections, problems };
}

/**
 * The sections asked for, read from `env` and validated. Throws one error
 * that lists every problem found, with how to fix them.
 */
export function readConfig<S extends ConfigSection>(
	env: Env,
	sections: readonly S[],
): Pick<AppConfig, S> {
	const { sections: read, problems } = reader(env);
	const config = Object.fromEntries(
		sections.map((section) => [section, read[section]()]),
	) as Pick<AppConfig, S>;
	if (problems.length > 0) {
		throw new Error(
			[
				"Invalid configuration:",
				...problems.map((problem) => `- ${problem}`),
				HOW_TO_FIX,
			].join("\n"),
		);
	}
	return config;
}

/** One section, from the process's environment: what each module reads. */
export function configOf<S extends ConfigSection>(section: S): AppConfig[S] {
	return readConfig(process.env, [section])[section];
}

/**
 * The process's whole configuration, checked before anything starts: on any
 * problem it prints them all and exits.
 */
export function startupConfig<S extends ConfigSection>(
	sections: readonly S[],
): Pick<AppConfig, S> {
	try {
		return readConfig(process.env, sections);
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}
