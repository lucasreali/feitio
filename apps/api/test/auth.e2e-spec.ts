import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { readSessionConfig } from "../src/session/session.config.js";
import { SessionService } from "../src/session/session.service.js";
import { Fixtures, type TestTenant, type TestUser } from "./fixtures.js";

// Runs against the real PostgreSQL and Valkey in .env.
describe("Admin panel sign-in (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	const { cookieName } = readSessionConfig();
	let first: TestTenant;
	let second: TestTenant;
	let closed: TestTenant;
	let ana: TestUser;
	let withoutStore: TestUser;

	// Failed sign-ins are counted per IP in Valkey for 15 minutes, across
	// runs: each run and each limit test signs in from its own address.
	const randomIp = () =>
		`10.${[1, 2, 3].map(() => Math.floor(Math.random() * 255)).join(".")}`;
	const ip = randomIp();
	const login = (payload: unknown, remoteAddress = ip) =>
		app.inject({
			method: "POST",
			url: "/auth/login",
			payload: payload as object,
			remoteAddress,
		});
	/** Signs in and returns the session cookie. */
	const signIn = async (user: TestUser) => {
		const response = await login({
			email: user.email,
			password: user.password,
		});
		expect(response.statusCode).toBe(200);
		const cookie = response.cookies.find((c) => c.name === cookieName);
		if (!cookie?.value) {
			throw new Error("Session cookie was not set");
		}
		return cookie.value;
	};
	/** A CSRF token for the session, with the cookies to send it with. */
	const csrf = async (session: string) => {
		const response = await app.inject({
			method: "GET",
			url: "/csrf-token",
			cookies: { [cookieName]: session },
		});
		const secret = response.cookies.find((c) => c.name === "_csrf")?.value;
		return {
			cookies: { [cookieName]: session, _csrf: secret ?? "" },
			headers: {
				"x-csrf-token": response.json<{ token: string }>().token,
			},
		};
	};
	const isSignedIn = async (session: string) =>
		(
			await app.inject({
				method: "GET",
				url: "/csrf-token",
				cookies: { [cookieName]: session },
			})
		).statusCode === 200;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();
		app = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();

		fixtures = await Fixtures.open();
		first = await fixtures.tenant();
		second = await fixtures.tenant();
		closed = await fixtures.tenant("inactive");
		ana = await fixtures.user();
		withoutStore = await fixtures.user();
		await fixtures.member(first, ana, "owner");
		await fixtures.member(second, ana, "staff");
		await fixtures.member(closed, ana, "owner");
		await fixtures.member(closed, withoutStore, "owner");
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [ana, withoutStore]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	describe("POST /auth/login", () => {
		it("starts a session in the user's first active store and describes the user", async () => {
			const response = await login({
				email: ana.email,
				password: ana.password,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				id: ana.id,
				email: ana.email,
				name: ana.name,
				activeTenantId: first.id,
				tenants: [
					{
						id: first.id,
						slug: first.slug,
						name: first.name,
						role: "owner",
					},
					{
						id: second.id,
						slug: second.slug,
						name: second.name,
						role: "staff",
					},
				],
			});
			expect(response.body).not.toContain("scrypt");
			const cookie = response.cookies.find((c) => c.name === cookieName);
			expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
			expect(await isSignedIn(cookie?.value ?? "")).toBe(true);
		});

		it("accepts the e-mail in any case and with spaces around it", async () => {
			const response = await login({
				email: `  ${ana.email.toUpperCase()} `,
				password: ana.password,
			});
			expect(response.statusCode).toBe(200);
		});

		it("gives the same 401 for a wrong password, an unknown e-mail and a user without an active store", async () => {
			const answers = await Promise.all([
				login({ email: ana.email, password: `${ana.password}x` }),
				login({ email: "nobody@feitio.test", password: ana.password }),
				login({ email: "not-an-email", password: ana.password }),
				login({
					email: withoutStore.email,
					password: withoutStore.password,
				}),
			]);

			for (const response of answers) {
				expect(response.statusCode).toBe(401);
				expect(response.json()).toEqual(answers[0].json());
				expect(
					response.cookies.find((c) => c.name === cookieName),
				).toBeUndefined();
			}
		});

		it.each([
			["no body", undefined],
			["no password", { email: "a@b.com" }],
			["no e-mail", { password: "x" }],
			["a number as password", { email: "a@b.com", password: 1 }],
		])("answers 400 to %s", async (_case, payload) => {
			expect((await login(payload)).statusCode).toBe(400);
		});
	});

	describe("sign-in attempt limits", () => {
		const wrong = (user: TestUser, from: string) =>
			login({ email: user.email, password: "wrong password" }, from);
		const right = (user: TestUser, from: string) =>
			login({ email: user.email, password: user.password }, from);
		const newMember = async () => {
			const user = await fixtures.user();
			await fixtures.member(first, user, "staff");
			return user;
		};
		const randomIpv6Network = () =>
			`2001:db8:${[1, 2].map(() => Math.floor(Math.random() * 0xffff).toString(16)).join(":")}`;

		it("blocks an e-mail from one address after 5 failures, even with the right password", async () => {
			const target = await newMember();
			const from = randomIp();
			for (let attempt = 0; attempt < 5; attempt++) {
				expect((await wrong(target, from)).statusCode).toBe(401);
			}

			const blocked = await right(target, from);
			expect(blocked.statusCode).toBe(429);
			const retryAfter = Number(blocked.headers["retry-after"]);
			expect(retryAfter).toBeGreaterThan(0);
			expect(retryAfter).toBeLessThanOrEqual(15 * 60);
			// The owner of the e-mail, elsewhere, is not locked out by it.
			expect((await right(target, randomIp())).statusCode).toBe(200);
			// Nor are other users at that address.
			expect((await right(ana, from)).statusCode).toBe(200);
		});

		it("counts attempts before checking the password, so parallel guesses cannot slip past the limit", async () => {
			const target = await newMember();
			const from = randomIp();

			const answers = await Promise.all(
				Array.from({ length: 15 }, () => wrong(target, from)),
			);

			const codes = answers.map((response) => response.statusCode);
			expect(codes.filter((code) => code === 401)).toHaveLength(5);
			expect(codes.filter((code) => code === 429)).toHaveLength(10);
		});

		it("blocks an e-mail everywhere after 100 failures from many addresses", async () => {
			const target = await newMember();
			for (let batch = 0; batch < 10; batch++) {
				await Promise.all(
					Array.from({ length: 10 }, () => wrong(target, randomIp())),
				);
			}

			expect((await right(target, randomIp())).statusCode).toBe(429);
		}, 60_000); // 100 password checks.

		it("starts the count over after a successful sign-in", async () => {
			const target = await newMember();
			const from = randomIp();
			for (const round of [1, 2]) {
				for (let attempt = 0; attempt < 4; attempt++) {
					await wrong(target, from);
				}
				expect(
					(await right(target, from)).statusCode,
					`round ${round}`,
				).toBe(200);
			}
		});

		it("blocks an address after 30 failures, whatever the e-mails", async () => {
			const from = randomIp();
			for (let attempt = 0; attempt < 30; attempt++) {
				const response = await login(
					{ email: `nobody-${attempt}@feitio.test`, password: "x" },
					from,
				);
				expect(response.statusCode).toBe(401);
			}

			expect((await right(ana, from)).statusCode).toBe(429);
			expect((await right(ana, randomIp())).statusCode).toBe(200);
		});

		it("counts IPv6 addresses by their /64 network", async () => {
			const network = randomIpv6Network();
			for (let attempt = 0; attempt < 30; attempt++) {
				await login(
					{ email: `nobody-${attempt}@feitio.test`, password: "x" },
					`${network}:${attempt.toString(16)}::1`,
				);
			}

			expect((await right(ana, `${network}:ffff::2`)).statusCode).toBe(
				429,
			);
			expect(
				(await right(ana, `${randomIpv6Network()}::1`)).statusCode,
			).toBe(200);
		});
	});

	describe("GET /auth/me", () => {
		const me = (session?: string) =>
			app.inject({
				method: "GET",
				url: "/auth/me",
				cookies: session ? { [cookieName]: session } : {},
			});

		it("describes the signed-in user and their active store", async () => {
			const response = await me(await signIn(ana));

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				id: ana.id,
				email: ana.email,
				name: ana.name,
				activeTenantId: first.id,
			});
			expect(
				response.json().tenants.map((t: { id: string }) => t.id),
			).toEqual([first.id, second.id]);
			expect(response.body).not.toContain(ana.cpf);
		});

		it("answers 401 without a session", async () => {
			expect((await me()).statusCode).toBe(401);
		});
	});

	describe("POST /auth/tenant", () => {
		const switchTo = async (session: string, tenantId: unknown) =>
			app.inject({
				method: "POST",
				url: "/auth/tenant",
				payload: { tenantId },
				...(await csrf(session)),
			});
		const activeTenantOf = async (session: string) =>
			(
				await app.inject({
					method: "GET",
					url: "/auth/me",
					cookies: { [cookieName]: session },
				})
			).json().activeTenantId;

		it("moves the user to another of their stores with a new session", async () => {
			const before = await signIn(ana);

			const response = await switchTo(before, second.id);

			expect(response.statusCode).toBe(200);
			expect(response.json().activeTenantId).toBe(second.id);
			const after = response.cookies.find((c) => c.name === cookieName);
			expect(after?.value).toBeTruthy();
			expect(await activeTenantOf(after?.value ?? "")).toBe(second.id);
			// The old token is gone, and its CSRF tokens with it.
			expect(await isSignedIn(before)).toBe(false);
		});

		it("refuses a store the user does not belong to or that is inactive", async () => {
			const stranger = await fixtures.tenant();
			const session = await signIn(ana);

			for (const tenantId of [stranger.id, closed.id]) {
				const response = await switchTo(session, tenantId);
				expect(response.statusCode).toBe(403);
			}
			expect(await activeTenantOf(session)).toBe(first.id);
		});

		it.each([undefined, 42, "not-an-id"])(
			"answers 400 to the tenant id %j",
			async (tenantId) => {
				const response = await switchTo(await signIn(ana), tenantId);
				expect(response.statusCode).toBe(400);
			},
		);
	});

	describe("POST /auth/logout", () => {
		it("ends the current session and clears its cookie", async () => {
			const session = await signIn(ana);
			const other = await signIn(ana);

			const response = await app.inject({
				method: "POST",
				url: "/auth/logout",
				...(await csrf(session)),
			});

			expect(response.statusCode).toBe(204);
			expect(
				response.cookies.find((c) => c.name === cookieName)?.value,
			).toBe("");
			expect(await isSignedIn(session)).toBe(false);
			expect(await isSignedIn(other)).toBe(true);
		});

		it("needs a CSRF token", async () => {
			const session = await signIn(ana);
			const response = await app.inject({
				method: "POST",
				url: "/auth/logout",
				cookies: { [cookieName]: session },
			});

			expect(response.statusCode).toBe(403);
			expect(await isSignedIn(session)).toBe(true);
		});
	});

	describe("POST /auth/logout-all", () => {
		it("ends every session of the user", async () => {
			const here = await signIn(ana);
			const elsewhere = await signIn(ana);

			const response = await app.inject({
				method: "POST",
				url: "/auth/logout-all",
				...(await csrf(here)),
			});

			expect(response.statusCode).toBe(204);
			expect(
				response.cookies.find((c) => c.name === cookieName)?.value,
			).toBe("");
			expect(await isSignedIn(here)).toBe(false);
			expect(await isSignedIn(elsewhere)).toBe(false);
		});
	});
});
