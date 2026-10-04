import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { storeSettings } from "../../src/database/schemas/store-settings.js";
import { readSessionConfig } from "../../src/session/session.config.js";
import { SessionService } from "../../src/session/session.service.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../../src/tenancy/tenant-database.js";
import { Fixtures, type TestTenant, type TestUser } from "../fixtures.js";

// Runs against the real PostgreSQL and Valkey in .env.
describe("PATCH /admin/store/settings (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	const { cookieName } = readSessionConfig();
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let staff: TestUser;
	let otherOwner: TestUser;

	/** Signs in with a session cookie and a CSRF token. */
	const signIn = async (user: TestUser) => {
		const login = await app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { email: user.email, password: user.password },
		});
		const session = login.cookies.find((c) => c.name === cookieName)?.value;
		if (!session) {
			throw new Error(`Sign-in failed: ${login.statusCode}`);
		}
		const csrf = await app.inject({
			method: "GET",
			url: "/csrf-token",
			cookies: { [cookieName]: session },
		});
		return {
			cookies: {
				[cookieName]: session,
				_csrf:
					csrf.cookies.find((c) => c.name === "_csrf")?.value ?? "",
			},
			headers: { "x-csrf-token": csrf.json<{ token: string }>().token },
		};
	};
	const patch = (
		auth: {
			cookies?: Record<string, string>;
			headers?: Record<string, string>;
		},
		payload: unknown,
	) =>
		app.inject({
			method: "PATCH",
			url: "/admin/store/settings",
			payload: payload as object,
			...auth,
		});
	const publicSettings = (tenant: TestTenant) =>
		app.inject({
			method: "GET",
			url: "/store/settings",
			headers: { "x-tenant": tenant.slug },
		});

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
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		[owner, staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, owner, "owner");
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
		const tenantDb = moduleRef.get(TenantDatabase);
		for (const tenant of [store, otherStore]) {
			await TenantContext.run(tenant, () =>
				tenantDb.run((tx) =>
					tx.insert(storeSettings).values({
						tenantId: tenant.id,
						displayName: tenant.name,
					}),
				),
			);
		}
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [owner, staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	it("lets the owner change the name, logo and theme the stores show", async () => {
		const changes = {
			displayName: "Aurora Ateliê",
			logoUrl: "https://cdn.example.com/aurora.png",
			theme: { primary: "#C2410C", radius: "0.75rem" },
		};

		const response = await patch(await signIn(owner), changes);

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual(changes);
		expect((await publicSettings(store)).json()).toEqual(changes);
	});

	it("changes only the fields sent, and removes the logo with null", async () => {
		const auth = await signIn(owner);
		await patch(auth, {
			displayName: "Before",
			logoUrl: "https://cdn.example.com/a.png",
			theme: { primary: "#000000" },
		});

		const response = await patch(auth, { logoUrl: null });

		expect(response.json()).toEqual({
			displayName: "Before",
			logoUrl: null,
			theme: { primary: "#000000" },
		});
	});

	it("never touches another store", async () => {
		await patch(await signIn(owner), { displayName: "Mine" });

		expect((await publicSettings(otherStore)).json().displayName).toBe(
			otherStore.name,
		);
	});

	it("refuses staff members", async () => {
		const response = await patch(await signIn(staff), { displayName: "x" });
		expect(response.statusCode).toBe(403);
	});

	it("refuses requests without a session or without a CSRF token", async () => {
		expect((await patch({}, { displayName: "x" })).statusCode).toBe(401);
		const { cookies } = await signIn(owner);
		expect(
			(await patch({ cookies }, { displayName: "x" })).statusCode,
		).toBe(403);
	});

	it("answers 400 to invalid changes and keeps the settings", async () => {
		const auth = await signIn(owner);
		await patch(auth, { displayName: "Kept" });

		for (const body of [
			{},
			{ logoUrl: "javascript:alert(1)" },
			{ theme: { primary: "red; background: url(x)" } },
			{ displayName: "" },
		]) {
			expect((await patch(auth, body)).statusCode).toBe(400);
		}
		expect((await publicSettings(store)).json().displayName).toBe("Kept");
	});
});
