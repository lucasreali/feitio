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

	const login = (payload: unknown) =>
		app.inject({
			method: "POST",
			url: "/auth/login",
			payload: payload as object,
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
