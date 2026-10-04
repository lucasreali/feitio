import { readSessionConfig } from "./session.config.js";

const SECRET = "s".repeat(32);

describe("readSessionConfig", () => {
	const saved = { ...process.env };
	const setEnv = (values: Record<string, string | undefined>) => {
		for (const name of [
			"COOKIE_SECRET",
			"SESSION_COOKIE_NAME",
			"SESSION_COOKIE_DOMAIN",
			"SESSION_TTL_SECONDS",
			"NODE_ENV",
		]) {
			delete process.env[name];
		}
		for (const [name, value] of Object.entries(values)) {
			if (value !== undefined) {
				process.env[name] = value;
			}
		}
	};

	afterEach(() => {
		process.env = { ...saved };
	});

	it("uses the defaults when only COOKIE_SECRET is set", () => {
		setEnv({ COOKIE_SECRET: SECRET });

		expect(readSessionConfig()).toEqual({
			cookieSecret: SECRET,
			cookieName: "feitio_session",
			cookieDomain: undefined,
			ttlSeconds: 7 * 24 * 60 * 60,
			secure: false,
		});
	});

	it("reads name, domain and lifetime from the environment", () => {
		setEnv({
			COOKIE_SECRET: SECRET,
			SESSION_COOKIE_NAME: "panel",
			SESSION_COOKIE_DOMAIN: ".feitio.com.br",
			SESSION_TTL_SECONDS: "3600",
		});

		expect(readSessionConfig()).toMatchObject({
			cookieName: "panel",
			cookieDomain: ".feitio.com.br",
			ttlSeconds: 3600,
		});
	});

	it("treats empty optional variables as unset", () => {
		setEnv({
			COOKIE_SECRET: SECRET,
			SESSION_COOKIE_NAME: "",
			SESSION_COOKIE_DOMAIN: "",
			SESSION_TTL_SECONDS: "",
		});

		expect(readSessionConfig()).toMatchObject({
			cookieName: "feitio_session",
			cookieDomain: undefined,
			ttlSeconds: 7 * 24 * 60 * 60,
		});
	});

	it("makes cookies secure only in production", () => {
		setEnv({ COOKIE_SECRET: SECRET, NODE_ENV: "production" });
		expect(readSessionConfig().secure).toBe(true);

		setEnv({ COOKIE_SECRET: SECRET, NODE_ENV: "development" });
		expect(readSessionConfig().secure).toBe(false);
	});

	it("fails without COOKIE_SECRET", () => {
		setEnv({});
		expect(() => readSessionConfig()).toThrow("COOKIE_SECRET is not set.");
	});

	it("fails with a COOKIE_SECRET shorter than 32 characters", () => {
		setEnv({ COOKIE_SECRET: "s".repeat(31) });
		expect(() => readSessionConfig()).toThrow(
			"COOKIE_SECRET must have at least 32 characters.",
		);
	});

	it.each(["abc", "1.5", "0", "-60"])(
		"fails with SESSION_TTL_SECONDS=%s",
		(ttl) => {
			setEnv({ COOKIE_SECRET: SECRET, SESSION_TTL_SECONDS: ttl });
			expect(() => readSessionConfig()).toThrow(
				"SESSION_TTL_SECONDS must be a positive whole number of seconds.",
			);
		},
	);
});
