import {
	Body,
	Controller,
	Get,
	Module,
	Post,
	Req,
	Res,
	UseGuards,
} from "@nestjs/common";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyReply, FastifyRequest } from "fastify";
import { configureApp } from "../src/app.setup.js";
import { TenantId, UserId } from "../src/domain/ids.js";
import { CurrentSession } from "../src/session/current-session.decorator.js";
import {
	readSessionConfig,
	SESSION_CONFIG,
} from "../src/session/session.config.js";
import { SessionGuard } from "../src/session/session.guard.js";
import { SessionModule } from "../src/session/session.module.js";
import {
	type NewSession,
	type Session,
	SessionService,
} from "../src/session/session.service.js";
import { Valkey } from "../src/valkey/valkey.js";

// Runs against the real Valkey in VALKEY_URL (`pnpm services:up`).

/** Test-only routes that exercise the session service and guard over HTTP. */
@Controller("test-session")
class TestSessionController {
	constructor(private readonly sessions: SessionService) {}

	@Post("start")
	async start(
		@Body() body: { userId: string; tenantId: string },
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		// Routes take primitives; the domain types start here.
		await this.sessions.create(reply, {
			userId: UserId.parse(body.userId),
			tenantId: TenantId.parse(body.tenantId),
		});
		return { ok: true };
	}

	@Get("me")
	@UseGuards(SessionGuard)
	me(@CurrentSession() session: Session) {
		return session;
	}

	@Post("change")
	@UseGuards(SessionGuard)
	change(@CurrentSession() session: Session) {
		return { changedBy: session.userId };
	}

	@Post("end")
	async end(
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		await this.sessions.destroy(request, reply);
		return { ok: true };
	}
}

@Module({ imports: [SessionModule], controllers: [TestSessionController] })
class TestSessionModule {}

const TTL_SECONDS = 2;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Sessions (e2e)", () => {
	let app: NestFastifyApplication;
	let sessions: SessionService;
	const config = {
		...readSessionConfig(),
		ttlSeconds: TTL_SECONDS,
		secure: true,
	};
	const users: UserId[] = [];

	const start = async (owner = newOwner()) => {
		const response = await app.inject({
			method: "POST",
			url: "/test-session/start",
			payload: owner,
		});
		expect(response.statusCode).toBe(201);
		const cookie = response.cookies.find(
			(c) => c.name === config.cookieName,
		);
		if (!cookie) {
			throw new Error("Session cookie was not set");
		}
		return { owner, cookie };
	};
	const me = (cookieValue?: string) =>
		app.inject({
			method: "GET",
			url: "/test-session/me",
			cookies: cookieValue ? { [config.cookieName]: cookieValue } : {},
		});
	function newOwner(userId = UserId.generate()): NewSession {
		users.push(userId);
		return { userId, tenantId: TenantId.generate() };
	}

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [TestSessionModule],
		})
			.overrideProvider(SESSION_CONFIG)
			.useValue(config)
			.compile();
		app = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		sessions = moduleRef.get(SessionService);
	});

	afterAll(async () => {
		for (const userId of users) {
			await sessions.destroyAllForUser(userId);
		}
		await app.close();
	});

	it("creates a session that is read back through its cookie", async () => {
		const { owner, cookie } = await start();

		expect(cookie).toMatchObject({
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
			path: "/",
			maxAge: TTL_SECONDS,
		});
		// The cookie carries only the signed random token, never user data.
		expect(cookie.value).not.toContain(owner.userId);
		expect(cookie.value).not.toContain(owner.tenantId);

		const response = await me(cookie.value);
		expect(response.statusCode).toBe(200);
		const session = response.json<Session>();
		expect(session).toMatchObject(owner);
		expect(Date.parse(session.createdAt)).not.toBeNaN();
		expect(Date.parse(session.lastUsedAt)).toBeGreaterThanOrEqual(
			Date.parse(session.createdAt),
		);
	});

	it("renews the expiration on every use", async () => {
		const { cookie } = await start();

		await sleep(1200);
		expect((await me(cookie.value)).statusCode).toBe(200);
		await sleep(1200);
		// 2.4 s after creation, past the 2 s TTL, but only 1.2 s since last use.
		expect((await me(cookie.value)).statusCode).toBe(200);
	});

	it("rejects an expired session", async () => {
		const { cookie } = await start();

		await sleep(TTL_SECONDS * 1000 + 500);
		expect((await me(cookie.value)).statusCode).toBe(401);
	});

	it("rejects a session after it is ended", async () => {
		const { cookie } = await start();

		const end = await app.inject({
			method: "POST",
			url: "/test-session/end",
			cookies: { [config.cookieName]: cookie.value },
		});
		expect(end.statusCode).toBe(201);
		expect(
			end.cookies.find((c) => c.name === config.cookieName)?.value,
		).toBe("");
		expect((await me(cookie.value)).statusCode).toBe(401);
	});

	it("ends every session of a user and keeps other users' sessions", async () => {
		const userId = UserId.generate();
		const first = await start(newOwner(userId));
		const second = await start(newOwner(userId));
		const otherUser = await start();

		expect(await sessions.destroyAllForUser(userId)).toBe(2);

		expect((await me(first.cookie.value)).statusCode).toBe(401);
		expect((await me(second.cookie.value)).statusCode).toBe(401);
		expect((await me(otherUser.cookie.value)).statusCode).toBe(200);
	});

	it("does not bring back a session ended while it was being renewed", async () => {
		const { owner, cookie } = await start();
		const valkey = app.get(Valkey);
		const originalGet = valkey.get.bind(valkey);
		// End every session of the user right after the renewal read it.
		const spy = vi
			.spyOn(valkey, "get")
			.mockImplementationOnce(async (key) => {
				const value = await originalGet(key);
				await sessions.destroyAllForUser(owner.userId);
				return value;
			});

		expect((await me(cookie.value)).statusCode).toBe(401);
		spy.mockRestore();
		expect((await me(cookie.value)).statusCode).toBe(401);
		expect(await sessions.destroyAllForUser(owner.userId)).toBe(0);
	});

	it("ends nothing and clears the cookie when there is no session", async () => {
		const end = (cookies: Record<string, string>) =>
			app.inject({ method: "POST", url: "/test-session/end", cookies });
		const forged = app
			.getHttpAdapter()
			.getInstance()
			.signCookie(crypto.randomUUID());

		for (const cookies of [{}, { [config.cookieName]: forged }]) {
			const response = await end(cookies);
			expect(response.statusCode).toBe(201);
			expect(
				response.cookies.find((c) => c.name === config.cookieName)
					?.value,
			).toBe("");
		}
	});

	it("rejects a tampered cookie", async () => {
		const { cookie } = await start();
		const [token, signature] = cookie.value.split(".");
		const flip = (text: string) =>
			(text[0] === "A" ? "B" : "A") + text.slice(1);

		expect((await me(`${flip(token)}.${signature}`)).statusCode).toBe(401);
		expect((await me(`${token}.${flip(signature)}`)).statusCode).toBe(401);
		expect((await me(token)).statusCode).toBe(401);
	});

	it("rejects a correctly signed cookie with an unknown id", async () => {
		const forged = app
			.getHttpAdapter()
			.getInstance()
			.signCookie(crypto.randomUUID());

		expect((await me(forged)).statusCode).toBe(401);
	});

	describe("CSRF on session-protected routes", () => {
		// Tokens are bound to the session that asks for them.
		const csrfToken = async (sessionCookie: string) => {
			const response = await app.inject({
				method: "GET",
				url: "/csrf-token",
				cookies: { [config.cookieName]: sessionCookie },
			});
			expect(response.statusCode).toBe(200);
			const secret = response.cookies.find((c) => c.name === "_csrf");
			if (!secret) {
				throw new Error("CSRF secret cookie was not set");
			}
			return { token: response.json<{ token: string }>().token, secret };
		};
		const change = (cookies: Record<string, string>, token?: string) =>
			app.inject({
				method: "POST",
				url: "/test-session/change",
				cookies,
				headers: token ? { "x-csrf-token": token } : {},
			});

		it("refuses a data-changing request without a CSRF token", async () => {
			const { cookie } = await start();
			const { secret, token } = await csrfToken(cookie.value);

			const withoutToken = await change({
				[config.cookieName]: cookie.value,
				_csrf: secret.value,
			});
			expect(withoutToken.statusCode).toBe(403);

			const withoutSecret = await change(
				{ [config.cookieName]: cookie.value },
				token,
			);
			expect(withoutSecret.statusCode).toBe(403);
		});

		it("refuses a forged CSRF token", async () => {
			const { cookie } = await start();
			const { secret, token } = await csrfToken(cookie.value);

			const response = await change(
				{ [config.cookieName]: cookie.value, _csrf: secret.value },
				`${token.slice(0, -2)}xx`,
			);
			expect(response.statusCode).toBe(403);
		});

		it("refuses a token issued to another session", async () => {
			const attacker = await start();
			const victim = await start();
			// Secret and token the attacker obtained for their own session.
			const { secret, token } = await csrfToken(attacker.cookie.value);

			const response = await change(
				{
					[config.cookieName]: victim.cookie.value,
					_csrf: secret.value,
				},
				token,
			);
			expect(response.statusCode).toBe(403);
		});

		it("accepts a data-changing request with a valid CSRF token", async () => {
			const { owner, cookie } = await start();
			const { secret, token } = await csrfToken(cookie.value);
			// `secure` follows NODE_ENV in configureApp(), not this test's config.
			expect(secret).toMatchObject({
				httpOnly: true,
				sameSite: "Lax",
				path: "/",
			});

			const response = await change(
				{ [config.cookieName]: cookie.value, _csrf: secret.value },
				token,
			);
			expect(response.statusCode).toBe(201);
			expect(response.json()).toEqual({ changedBy: owner.userId });
		});

		it("still answers 401 before checking CSRF when there is no session", async () => {
			expect((await change({})).statusCode).toBe(401);
		});

		it("does not require a CSRF token for reads", async () => {
			const { cookie } = await start();
			expect((await me(cookie.value)).statusCode).toBe(200);
		});
	});

	it("scopes the cookie to the configured domain", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [TestSessionModule],
		})
			.overrideProvider(SESSION_CONFIG)
			.useValue({ ...config, cookieDomain: ".feitio.test" })
			.compile();
		const scoped = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(scoped);
		await scoped.init();
		const owner = newOwner();

		const response = await scoped.inject({
			method: "POST",
			url: "/test-session/start",
			payload: owner,
		});
		expect(
			response.cookies.find((c) => c.name === config.cookieName)?.domain,
		).toBe(".feitio.test");
		await scoped.close();
	});

	it("refuses protected routes without a session, with a generic message", async () => {
		const response = await me();

		expect(response.statusCode).toBe(401);
		expect(response.json()).toEqual({
			message: "Unauthorized",
			statusCode: 401,
		});
	});
});
