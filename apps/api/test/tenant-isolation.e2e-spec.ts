import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import pg from "pg";
import { DATABASE, type Database } from "../src/database/database.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { storeSettings } from "../src/database/schemas/store-settings.js";
import { TenantId } from "../src/domain/ids.js";
import { TenantSlug } from "../src/domain/tenant-slug.js";
import { TenancyModule } from "../src/tenancy/tenancy.module.js";
import {
	type CurrentTenant,
	TenantContext,
} from "../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../src/tenancy/tenant-database.js";

// Runs against the real PostgreSQL in .env: DATABASE_URL is the application
// role (feitio_app), MIGRATION_DATABASE_URL the owner of the tables.
describe("Tenant isolation (e2e)", () => {
	let tenantDb: TenantDatabase;
	let appDb: Database;
	let owner: pg.Client;
	let app: pg.Client;
	const newTenant = (): CurrentTenant => {
		const id = TenantId.generate();
		return { id, slug: TenantSlug.parse(`test-${id.slice(-12)}`) };
	};
	const tenantA = newTenant();
	const tenantB = newTenant();

	const inTenant = <T>(tenant: CurrentTenant, fn: () => Promise<T>) =>
		TenantContext.run(tenant, fn);
	const visibleSettings = (tenant: CurrentTenant) =>
		inTenant(tenant, () =>
			tenantDb.run((tx) => tx.select().from(storeSettings)),
		);

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [DatabaseModule, TenancyModule],
		}).compile();
		tenantDb = moduleRef.get(TenantDatabase);
		appDb = moduleRef.get(DATABASE);

		owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await Promise.all([owner.connect(), app.connect()]);

		// Tenants are managed by the owner; settings go in through the app role.
		for (const tenant of [tenantA, tenantB]) {
			await owner.query(
				"insert into tenants (id, name, slug) values ($1, $2, $3)",
				[tenant.id, `Test ${tenant.slug}`, tenant.slug],
			);
			await inTenant(tenant, () =>
				tenantDb.run((tx) =>
					tx.insert(storeSettings).values({
						tenantId: tenant.id,
						displayName: `Store ${tenant.slug}`,
					}),
				),
			);
		}
	});

	afterAll(async () => {
		await owner.query("delete from tenants where id = any($1)", [
			[tenantA.id, tenantB.id],
		]);
		await Promise.all([owner.end(), app.end()]);
	});

	it("shows a tenant only its own rows, with no filter in the query", async () => {
		const seenByA = await visibleSettings(tenantA);
		const seenByB = await visibleSettings(tenantB);

		expect(seenByA.map((row) => row.tenantId)).toEqual([tenantA.id]);
		expect(seenByB.map((row) => row.tenantId)).toEqual([tenantB.id]);
	});

	it("returns no rows to a query outside any tenant context", async () => {
		expect(await appDb.select().from(storeSettings)).toEqual([]);
		expect((await app.query("select * from store_settings")).rows).toEqual(
			[],
		);
	});

	it("refuses TenantDatabase.run outside a tenant context", () => {
		expect(() => tenantDb.run(async () => undefined)).toThrow(
			/tenant context/,
		);
	});

	it("does not let a tenant write rows of another tenant", async () => {
		await expect(
			inTenant(tenantA, () =>
				tenantDb.run((tx) =>
					tx.insert(storeSettings).values({
						tenantId: TenantId.generate(),
						displayName: "x",
					}),
				),
			),
		).rejects.toThrow();

		const updatedByA = await inTenant(tenantA, () =>
			tenantDb.run((tx) =>
				tx
					.update(storeSettings)
					.set({ displayName: "Renamed by A" })
					.where(eq(storeSettings.tenantId, tenantB.id))
					.returning(),
			),
		);
		expect(updatedByA).toEqual([]);
		const [rowOfB] = await visibleSettings(tenantB);
		expect(rowOfB.displayName).toBe(`Store ${tenantB.slug}`);
	});

	describe("the application role", () => {
		const denied = (statement: string) =>
			expect(app.query(statement)).rejects.toMatchObject({
				code: "42501",
			});

		it("is not superuser, cannot bypass RLS and owns no business table", async () => {
			const { rows } = await app.query(
				"select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
			);
			expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
			const owners = await app.query(
				"select pg_get_userbyid(relowner) as owner from pg_class where relname in ('store_settings', 'tenants')",
			);
			for (const { owner: tableOwner } of owners.rows) {
				expect(tableOwner).not.toBe("feitio_app");
			}
		});

		it("cannot turn RLS off or drop the policies", async () => {
			await denied(
				"alter table store_settings disable row level security",
			);
			await denied(
				"alter table store_settings no force row level security",
			);
			await denied(
				"drop policy store_settings_tenant_isolation on store_settings",
			);
		});

		it("cannot skip RLS with row_security = off", async () => {
			await app.query("begin");
			try {
				await app.query("set local row_security = off");
				await expect(
					app.query("select * from store_settings"),
				).rejects.toMatchObject({
					code: "42501",
				});
			} finally {
				await app.query("rollback");
			}
		});

		it("cannot switch to the owner role", async () => {
			const { rows } = await owner.query("select current_user");
			await expect(
				app.query(`set role ${rows[0].current_user}`),
			).rejects.toMatchObject({ code: "42501" });
		});
	});
});
