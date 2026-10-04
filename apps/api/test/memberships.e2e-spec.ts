import pg from "pg";
import { TenantId, UserId } from "../src/domain/ids.js";

// Memberships tie a user to a tenant with a role. The application role sees a
// membership when it belongs to the current tenant (app.tenant_id) or to the
// current user (app.user_id, used to sign in before a tenant is chosen), and
// writes only in the current tenant.
describe("memberships table (e2e)", () => {
	let owner: pg.Client;
	let app: pg.Client;
	const tenantA = TenantId.generate();
	const tenantB = TenantId.generate();
	const ana = UserId.generate();
	const bia = UserId.generate();

	/** Runs `statement` as the application role with the given settings. */
	const asApp = async (
		settings: { tenant?: string; user?: string },
		statement: string,
		params: unknown[] = [],
	) => {
		await app.query("begin");
		try {
			await app.query(
				"select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
				[settings.tenant ?? "", settings.user ?? ""],
			);
			return await app.query(statement, params);
		} finally {
			await app.query("rollback");
		}
	};
	const insertMembership = (tenant: string, user: string, role = "owner") =>
		asApp(
			{ tenant },
			"insert into memberships (tenant_id, user_id, role) values ($1, $2, $3) returning id",
			[tenant, user, role],
		);
	const visible = async (settings: { tenant?: string; user?: string }) =>
		(
			await asApp(
				settings,
				"select tenant_id, user_id, role from memberships where tenant_id = any($1) order by role, tenant_id, user_id",
				[[tenantA, tenantB]],
			)
		).rows;

	beforeAll(async () => {
		owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await Promise.all([owner.connect(), app.connect()]);
		for (const id of [tenantA, tenantB]) {
			await owner.query(
				"insert into tenants (id, name, slug) values ($1, 'Test', $2)",
				[id, `test-${id.slice(-12)}`],
			);
		}
		for (const id of [ana, bia]) {
			await owner.query(
				"insert into users (id, email, name, password_hash) values ($1, $2, 'Test', 'x')",
				[id, `test-${id}@feitio.test`],
			);
		}
		// Ana owns A and works at B; Bia owns B. Memberships go in through
		// the application role, the same path the API takes.
		await app.query("begin");
		for (const [tenant, user, role] of [
			[tenantA, ana, "owner"],
			[tenantB, ana, "staff"],
			[tenantB, bia, "owner"],
		]) {
			await app.query("select set_config('app.tenant_id', $1, true)", [
				tenant,
			]);
			await app.query(
				"insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)",
				[tenant, user, role],
			);
		}
		await app.query("commit");
	});

	afterAll(async () => {
		await owner.query("delete from tenants where id = any($1)", [
			[tenantA, tenantB],
		]);
		await owner.query("delete from users where id = any($1)", [[ana, bia]]);
		await Promise.all([owner.end(), app.end()]);
	});

	it("shows a tenant only its own memberships", async () => {
		expect(await visible({ tenant: tenantA })).toEqual([
			{ tenant_id: tenantA, user_id: ana, role: "owner" },
		]);
		expect(await visible({ tenant: tenantB })).toEqual([
			{ tenant_id: tenantB, user_id: bia, role: "owner" },
			{ tenant_id: tenantB, user_id: ana, role: "staff" },
		]);
	});

	it("shows a user only their own memberships, across tenants", async () => {
		expect(await visible({ user: ana })).toEqual([
			{ tenant_id: tenantA, user_id: ana, role: "owner" },
			{ tenant_id: tenantB, user_id: ana, role: "staff" },
		]);
		expect(await visible({ user: bia })).toEqual([
			{ tenant_id: tenantB, user_id: bia, role: "owner" },
		]);
	});

	it("shows nothing outside a tenant or user context", async () => {
		expect(await visible({})).toEqual([]);
	});

	it("does not let a tenant write memberships of another tenant", async () => {
		await expect(
			asApp(
				{ tenant: tenantA },
				"insert into memberships (tenant_id, user_id, role) values ($1, $2, 'staff')",
				[tenantB, bia],
			),
		).rejects.toMatchObject({ code: "42501" });
		const updated = await asApp(
			{ tenant: tenantA },
			"update memberships set role = 'staff' where tenant_id = $1 returning id",
			[tenantB],
		);
		expect(updated.rows).toEqual([]);
	});

	it("does not let a user context write memberships", async () => {
		await expect(
			asApp(
				{ user: bia },
				"insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')",
				[tenantA, bia],
			),
		).rejects.toMatchObject({ code: "42501" });
	});

	it("keeps one membership per user and tenant, with a known role", async () => {
		await expect(insertMembership(tenantA, ana)).rejects.toMatchObject({
			code: "23505",
		});
		await expect(
			insertMembership(tenantA, bia, "admin"),
		).rejects.toMatchObject({ code: "22P02" });
	});

	it("is forced through RLS even for the owner of the tables", async () => {
		const { rows } = await owner.query(
			"select relforcerowsecurity from pg_class where relname = 'memberships'",
		);
		expect(rows).toEqual([{ relforcerowsecurity: true }]);
	});
});
