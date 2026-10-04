import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import pg from "pg";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import {
	type StoreTheme,
	storeSettings,
} from "../src/database/schemas/store-settings.js";
import { HttpsUrl } from "../src/domain/https-url.js";
import { TenantId } from "../src/domain/ids.js";
import { TenantSlug } from "../src/domain/tenant-slug.js";
import { TenantContext } from "../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../src/tenancy/tenant-database.js";

// Runs against the real PostgreSQL in .env (see tenant-isolation.e2e-spec.ts).
describe("GET /store/settings (e2e)", () => {
	let app: NestFastifyApplication;
	let owner: pg.Client;

	// Plain strings here: the API validates themes on write, not on read.
	const tenant = (
		status: "active" | "inactive",
		theme: Record<string, string>,
	) => {
		const id = TenantId.generate();
		const slug = TenantSlug.parse(`test-${id.slice(-12)}`);
		return { id, slug, status, displayName: `Store ${slug}`, theme };
	};
	const tenantA = tenant("active", { primary: "#1e3b32", radius: "0.5rem" });
	const tenantB = tenant("active", { primary: "#7a1f5c", accent: "#f2c14e" });
	const inactive = tenant("inactive", { primary: "#000000" });
	const withoutSettings = tenant("active", {});
	// Stored themes may hold keys the API does not know; they must not leak.
	const withUnknownKeys = tenant("active", {
		primary: "#123456",
		"font-family": "Comic Sans",
	});

	const getSettings = (headers: Record<string, string> = {}) =>
		app.inject({ method: "GET", url: "/store/settings", headers });

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
		await owner.connect();
		const tenantDb = moduleRef.get(TenantDatabase);
		await owner.query(
			"insert into tenants (id, name, slug, status) values ($1, $2, $3, $4)",
			[
				withoutSettings.id,
				withoutSettings.displayName,
				withoutSettings.slug,
				withoutSettings.status,
			],
		);
		for (const t of [tenantA, tenantB, inactive, withUnknownKeys]) {
			await owner.query(
				"insert into tenants (id, name, slug, status) values ($1, $2, $3, $4)",
				[t.id, t.displayName, t.slug, t.status],
			);
			await TenantContext.run(t, () =>
				tenantDb.run((tx) =>
					tx.insert(storeSettings).values({
						tenantId: t.id,
						displayName: t.displayName,
						logoUrl: HttpsUrl.parse(
							`https://cdn.example.com/${t.slug}.png`,
						),
						theme: t.theme as StoreTheme,
					}),
				),
			);
		}
	});

	afterAll(async () => {
		await owner.query("delete from tenants where id = any($1)", [
			[
				tenantA.id,
				tenantB.id,
				inactive.id,
				withoutSettings.id,
				withUnknownKeys.id,
			],
		]);
		await owner.end();
		await app.close();
	});

	it("returns each tenant's own settings and never another tenant's", async () => {
		for (const [own, other] of [
			[tenantA, tenantB],
			[tenantB, tenantA],
		]) {
			const response = await getSettings({ "x-tenant": own.slug });

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				displayName: own.displayName,
				logoUrl: `https://cdn.example.com/${own.slug}.png`,
				theme: own.theme,
			});
			expect(response.body).not.toContain(other.slug);
			expect(response.body).not.toContain(String(other.theme.primary));
		}
	});

	it("rejects a request without the tenant header", async () => {
		const response = await getSettings();
		expect(response.statusCode).toBe(400);
	});

	it("rejects unknown and inactive tenants with the same answer", async () => {
		const unknown = await getSettings({ "x-tenant": "nao-existe-loja" });
		const inactiveTenant = await getSettings({ "x-tenant": inactive.slug });

		expect(unknown.statusCode).toBe(404);
		expect(inactiveTenant.statusCode).toBe(404);
		expect(inactiveTenant.json()).toEqual(unknown.json());
	});

	it("answers 404 for an active tenant without settings", async () => {
		const response = await getSettings({
			"x-tenant": withoutSettings.slug,
		});

		expect(response.statusCode).toBe(404);
		expect(response.json()).toMatchObject({
			message: "Store settings not found",
		});
	});

	it("returns only the known theme variables", async () => {
		const response = await getSettings({
			"x-tenant": withUnknownKeys.slug,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().theme).toEqual({ primary: "#123456" });
	});

	it("works without cookies or a CSRF token", async () => {
		const response = await getSettings({ "x-tenant": tenantA.slug });
		expect(response.statusCode).toBe(200);
		expect(response.headers["set-cookie"]).toBeUndefined();
	});
});
