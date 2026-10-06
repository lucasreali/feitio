import { randomBytes } from "node:crypto";
import {
	API_SECTIONS,
	type ConfigSection,
	readConfig,
	WORKER_SECTIONS,
} from "./config.js";

/** Every variable the API needs, valid. */
const complete = {
	DATABASE_URL: "postgresql://feitio_app:pw@localhost:5432/feitio",
	MIGRATION_DATABASE_URL: "postgresql://postgres:pw@localhost:5432/feitio",
	STORAGE_ENDPOINT: "http://localhost:9000",
	STORAGE_REGION: "us-east-1",
	STORAGE_PUBLIC_BUCKET: "public",
	STORAGE_PRIVATE_BUCKET: "private",
	STORAGE_ACCESS_KEY_ID: "key",
	STORAGE_SECRET_ACCESS_KEY: "secret",
	STORAGE_PUBLIC_URL: "https://files.example.com/public",
	VALKEY_URL: "redis://localhost:6379",
	COOKIE_SECRET: "c".repeat(32),
	MELHOR_ENVIO_URL: "https://sandbox.melhorenvio.com.br",
	MELHOR_ENVIO_TOKEN: "token",
	MELHOR_ENVIO_USER_AGENT: "Feitio (tech@feitio.com.br)",
	ASAAS_URL: "https://api-sandbox.asaas.com",
	ASAAS_API_KEY: "$aact_key",
	ASAAS_WALLET_ID: "wallet",
	PAYMENT_FEE_PERCENT: "0",
	PAYMENT_SECRET_KEY: randomBytes(32).toString("base64"),
	PUBLIC_API_URL: "http://localhost:3000/",
	RESEND_API_KEY: "re_key",
	EMAIL_FROM: "Pedidos@Feitio.com.br",
};

const ALL_SECTIONS = [...new Set([...API_SECTIONS, ...WORKER_SECTIONS])];

const problems = (
	env: Record<string, string | undefined>,
	sections: readonly ConfigSection[] = API_SECTIONS,
) => {
	try {
		readConfig(env, sections);
		return [];
	} catch (error) {
		return (error as Error).message
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2));
	}
};

describe("readConfig", () => {
	it("reads every section the API needs, typed", () => {
		const config = readConfig(complete, API_SECTIONS);
		expect(config).toEqual({
			server: { port: 3000 },
			database: { url: complete.DATABASE_URL },
			storage: {
				endpoint: "http://localhost:9000",
				region: "us-east-1",
				publicBucket: "public",
				privateBucket: "private",
				accessKeyId: "key",
				secretAccessKey: "secret",
				publicUrl: "https://files.example.com/public",
			},
			valkey: { url: "redis://localhost:6379" },
			session: {
				cookieSecret: complete.COOKIE_SECRET,
				cookieName: "feitio_session",
				cookieDomain: undefined,
				ttlSeconds: 7 * 24 * 60 * 60,
				secure: false,
			},
			melhorEnvio: {
				url: complete.MELHOR_ENVIO_URL,
				token: "token",
				userAgent: complete.MELHOR_ENVIO_USER_AGENT,
			},
			asaas: {
				url: complete.ASAAS_URL,
				apiKey: "$aact_key",
				walletId: "wallet",
			},
			payments: {
				feePercent: 0,
				secretKey: complete.PAYMENT_SECRET_KEY,
				publicApiUrl: "http://localhost:3000",
			},
		});
	});

	it("reads only the sections asked for: the worker needs no storage nor carrier", () => {
		const { STORAGE_REGION, MELHOR_ENVIO_TOKEN, COOKIE_SECRET, ...worker } =
			complete;
		expect(Object.keys(readConfig(worker, WORKER_SECTIONS)).sort()).toEqual(
			["asaas", "database", "email", "payments", "valkey"],
		);
	});

	it("reads the e-mail settings only for the worker, which sends them all", () => {
		const { RESEND_API_KEY, EMAIL_FROM, ...api } = complete;
		expect(problems(api)).toEqual([]);
		expect(readConfig(complete, WORKER_SECTIONS).email).toEqual({
			resendApiKey: "re_key",
			from: "pedidos@feitio.com.br",
		});
	});

	it("lists every problem at once, not only the first", () => {
		const { ASAAS_API_KEY, VALKEY_URL, ...partial } = complete;
		expect(
			problems({
				...partial,
				PUBLIC_API_URL: "localhost",
				STORAGE_REGION: "",
			}),
		).toEqual([
			"STORAGE_REGION is missing.",
			"VALKEY_URL is missing.",
			"ASAAS_API_KEY is missing.",
			"PUBLIC_API_URL must be an http(s) URL.",
		]);
	});

	it("says how to fix it", () => {
		expect(() => readConfig({}, ["database"])).toThrow(
			"Copy apps/api/.env.example to apps/api/.env or set them in the environment.",
		);
	});

	it.each([
		[
			"the example's placeholder",
			"ASAAS_API_KEY",
			"replace-with-the-sandbox-key",
		],
		[
			"a <placeholder>",
			"DATABASE_URL",
			"postgresql://feitio_app.<project-ref>:<pw>@host/db",
		],
	])("refuses %s", (_, name, value) => {
		expect(problems({ ...complete, [name]: value })).toEqual([
			`${name} still has the example's placeholder.`,
		]);
	});

	it.each([
		["DATABASE_URL", "mysql://localhost/feitio", "a postgresql:// URL"],
		["VALKEY_URL", "http://localhost:6379", "a redis:// or rediss:// URL"],
		["STORAGE_ENDPOINT", "not a url", "an http(s) URL"],
		["ASAAS_URL", "ftp://asaas.com", "an http(s) URL"],
		["PORT", "70000", "a port from 1 to 65535"],
		["SESSION_TTL_SECONDS", "1.5", "a positive whole number of seconds"],
		["PAYMENT_FEE_PERCENT", "100", "a percent from 0 to 99.99"],
		["PAYMENT_FEE_PERCENT", "abc", "a percent from 0 to 99.99"],
		["PAYMENT_SECRET_KEY", "c2hvcnQ=", "32 random bytes in base64"],
		["EMAIL_FROM", "Loja pedidos@feitio.com.br", "an e-mail address"],
	])("refuses %s=%s", (name, value, expected) => {
		expect(problems({ ...complete, [name]: value }, ALL_SECTIONS)).toEqual([
			`${name} must be ${expected}.`,
		]);
	});

	it("refuses a COOKIE_SECRET shorter than 32 characters", () => {
		expect(
			problems({ ...complete, COOKIE_SECRET: "c".repeat(31) }),
		).toEqual(["COOKIE_SECRET must have at least 32 characters."]);
	});

	it("reads the session's optional settings, empty ones as unset", () => {
		const { session } = readConfig(
			{
				...complete,
				SESSION_COOKIE_NAME: "panel",
				SESSION_COOKIE_DOMAIN: "",
				SESSION_TTL_SECONDS: "3600",
				PORT: "8080",
			},
			["session", "server"],
		);
		expect(session).toMatchObject({
			cookieName: "panel",
			cookieDomain: undefined,
			ttlSeconds: 3600,
		});
	});

	describe("in production", () => {
		const production = {
			...complete,
			NODE_ENV: "production",
			MELHOR_ENVIO_URL: "https://melhorenvio.com.br",
			ASAAS_URL: "https://api.asaas.com",
			PUBLIC_API_URL: "https://api.feitio.com.br",
		};

		it("takes production's settings, with secure cookies", () => {
			expect(readConfig(production, API_SECTIONS).session.secure).toBe(
				true,
			);
		});

		it("refuses sandboxes and webhooks over plain http", () => {
			expect(
				problems({
					...production,
					MELHOR_ENVIO_URL: "https://sandbox.melhorenvio.com.br",
					ASAAS_URL: "https://api-sandbox.asaas.com",
					PUBLIC_API_URL: "http://api.feitio.com.br",
				}),
			).toEqual([
				"MELHOR_ENVIO_URL must not be a sandbox in production.",
				"ASAAS_URL must not be a sandbox in production.",
				"PUBLIC_API_URL must be an https URL in production.",
			]);
		});
	});
});
