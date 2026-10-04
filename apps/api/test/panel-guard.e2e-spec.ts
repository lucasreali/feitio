import { Body, Controller, Get, Module, Post, Res } from "@nestjs/common";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyReply } from "fastify";
import { configureApp } from "../src/app.setup.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { PanelScoped } from "../src/auth/panel-scoped.decorator.js";
import { TenantId, UserId } from "../src/domain/ids.js";
import { readSessionConfig } from "../src/session/session.config.js";
import { SessionService } from "../src/session/session.service.js";
import { TenantContext } from "../src/tenancy/tenant-context.js";
import { Fixtures, type TestTenant, type TestUser } from "./fixtures.js";

/** Test-only routes: one for any member, one for owners. */
@Controller("test-panel")
class TestPanelController {
	constructor(private readonly sessions: SessionService) {}

	@Post("start")
	async start(
		@Body() body: { userId: string; tenantId: string },
		@Res({ passthrough: true }) reply: FastifyReply,
	) {
		await this.sessions.create(reply, {
			userId: UserId.parse(body.userId),
			tenantId: TenantId.parse(body.tenantId),
		});
		return { ok: true };
	}

	@Get("members")
	@PanelScoped()
	members() {
		return { tenant: TenantContext.current() };
	}

	@Get("owners")
	@PanelScoped("owner")
	owners() {
		return { tenant: TenantContext.current() };
	}
}

@Module({ imports: [AuthModule], controllers: [TestPanelController] })
class TestPanelModule {}

describe("@PanelScoped() (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let sessions: SessionService;
	const { cookieName } = readSessionConfig();
	let store: TestTenant;
	let inactiveStore: TestTenant;
	let owner: TestUser;
	let staff: TestUser;
	let outsider: TestUser;

	/** A session cookie for `user` with `tenant` active. */
	const signIn = async (user: TestUser, tenant: TestTenant) => {
		const response = await app.inject({
			method: "POST",
			url: "/test-panel/start",
			payload: { userId: user.id, tenantId: tenant.id },
		});
		const cookie = response.cookies.find((c) => c.name === cookieName);
		if (!cookie) {
			throw new Error("Session cookie was not set");
		}
		return cookie.value;
	};
	const get = (path: string, cookie?: string) =>
		app.inject({
			method: "GET",
			url: `/test-panel/${path}`,
			cookies: cookie ? { [cookieName]: cookie } : {},
		});

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [TestPanelModule],
		}).compile();
		app = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		sessions = moduleRef.get(SessionService);

		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		inactiveStore = await fixtures.tenant("inactive");
		[owner, staff, outsider] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, owner, "owner");
		await fixtures.member(store, staff, "staff");
		await fixtures.member(inactiveStore, owner, "owner");
	});

	afterAll(async () => {
		for (const user of [owner, staff, outsider]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	it("runs the route in the session's tenant for any member", async () => {
		for (const user of [owner, staff]) {
			const response = await get("members", await signIn(user, store));

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				tenant: { id: store.id, slug: store.slug },
			});
		}
	});

	it("lets only owners into owner routes", async () => {
		expect(
			(await get("owners", await signIn(owner, store))).statusCode,
		).toBe(200);
		expect(
			(await get("owners", await signIn(staff, store))).statusCode,
		).toBe(403);
	});

	it("answers 401 without a session", async () => {
		expect((await get("members")).statusCode).toBe(401);
	});

	it("answers 401 when the user is not a member of the session's tenant", async () => {
		const response = await get("members", await signIn(outsider, store));
		expect(response.statusCode).toBe(401);
	});

	it("answers 401 for an inactive tenant, even to its owner", async () => {
		const response = await get(
			"owners",
			await signIn(owner, inactiveStore),
		);
		expect(response.statusCode).toBe(401);
	});

	it("checks the membership on every request, so removing it takes effect at once", async () => {
		const removed = await fixtures.user();
		await fixtures.member(store, removed, "staff");
		const cookie = await signIn(removed, store);
		expect((await get("members", cookie)).statusCode).toBe(200);

		await fixtures.query("delete from users where id = $1", [removed.id]);

		expect((await get("members", cookie)).statusCode).toBe(401);
	});
});
