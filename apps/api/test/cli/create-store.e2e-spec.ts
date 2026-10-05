import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/app.setup.js";
import { createStore } from "../../src/cli/create-store.js";
import type { CreateStoreInput } from "../../src/cli/create-store-args.js";
import { Email } from "../../src/domain/email.js";
import { TenantSlug } from "../../src/domain/tenant-slug.js";
import { SessionService } from "../../src/session/session.service.js";
import { randomCpf } from "../fixtures.js";

// Runs against the real PostgreSQL and Valkey in .env.test, with the same two
// connections the command uses.
describe("create-store command (e2e)", () => {
	let app: NestFastifyApplication;
	let owner: pg.Client;
	let appRole: pg.Client;
	const slugs: string[] = [];
	const emails: string[] = [];

	const input = (
		overrides: Partial<CreateStoreInput> = {},
	): CreateStoreInput => {
		const id = crypto.randomUUID().slice(0, 8);
		const slug = TenantSlug.parse(`test-store-${id}`);
		const email = Email.parse(`test-owner-${id}@feitio.test`);
		slugs.push(slug);
		emails.push(email);
		return {
			slug,
			name: `Store ${id}`,
			owner: { email, name: `Owner ${id}`, cpf: randomCpf() },
			...overrides,
		};
	};
	const run = (values: CreateStoreInput) =>
		createStore(values, { owner, app: appRole });
	const login = (email: string, password: string) =>
		app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { email, password },
		});
	const count = async (
		table: "tenants" | "users",
		column: string,
		value: string,
	) =>
		Number(
			(
				await owner.query(
					`select count(*) from ${table} where ${column} = $1`,
					[value],
				)
			).rows[0].count,
		);

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
		owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		appRole = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await Promise.all([owner.connect(), appRole.connect()]);
	});

	afterAll(async () => {
		const { rows } = await owner.query<{ id: string }>(
			"select id from users where email = any($1)",
			[emails],
		);
		const sessions = app.get(SessionService);
		for (const { id } of rows) {
			await sessions.destroyAllForUser(id as never);
		}
		await owner.query("delete from tenants where slug = any($1)", [slugs]);
		await owner.query("delete from users where email = any($1)", [emails]);
		await Promise.all([owner.end(), appRole.end()]);
		await app.close();
	});

	it("creates an active store whose new owner can sign in with the printed password", async () => {
		const values = input();

		const result = await run(values);

		expect(result.password).toEqual(expect.any(String));
		expect(result.password?.length).toBeGreaterThanOrEqual(20);
		const response = await login(values.owner.email, result.password ?? "");
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			email: values.owner.email,
			name: values.owner.name,
			activeTenantId: result.tenantId,
			tenants: [
				{
					id: result.tenantId,
					slug: values.slug,
					name: values.name,
					role: "owner",
				},
			],
		});
		const settings = await app.inject({
			method: "GET",
			url: "/store/settings",
			headers: { "x-tenant": values.slug },
		});
		expect(settings.json()).toMatchObject({ displayName: values.name });
	});

	it("makes an existing user the owner of another store, keeping their password", async () => {
		const firstStore = input();
		const { password } = await run(firstStore);

		const second = await run(
			input({ owner: { email: firstStore.owner.email } }),
		);

		expect(second.password).toBeUndefined();
		const response = await login(firstStore.owner.email, password ?? "");
		expect(
			response.json().tenants.map((t: { id: string }) => t.id),
		).toContain(second.tenantId);
	});

	it("refuses a new user without a name and CPF", async () => {
		const values = input();
		await expect(
			run({ ...values, owner: { email: values.owner.email } }),
		).rejects.toThrow(/name and CPF/);
		expect(await count("tenants", "slug", values.slug)).toBe(0);
	});

	it("leaves nothing behind when the slug is taken", async () => {
		const taken = input();
		await run(taken);
		const values = input({ slug: taken.slug });

		await expect(run(values)).rejects.toThrow(/already in use/);
		expect(await count("users", "email", values.owner.email)).toBe(0);
	});
});
