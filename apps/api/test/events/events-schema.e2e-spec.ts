import pg from "pg";
import { Fixtures, type TestTenant } from "../fixtures.js";

const eventTables = ["domain_events", "processed_jobs"];

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

// Runs against the real PostgreSQL in .env, as the application role.
describe("Events schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let eventB: string;

	/** Runs statements in one transaction, bound to the tenant or as the relay. */
	const inTransaction = async <T>(
		settings: Record<string, string>,
		fn: (query: Query) => Promise<T>,
	): Promise<T> => {
		await app.query("begin");
		try {
			for (const [name, value] of Object.entries(settings)) {
				await app.query("select set_config($1, $2, true)", [
					name,
					value,
				]);
			}
			const result = await fn((text, params) => app.query(text, params));
			await app.query("commit");
			return result;
		} catch (error) {
			await app.query("rollback");
			throw error;
		}
	};
	const inTenant = <T>(
		tenant: TestTenant,
		fn: (query: Query) => Promise<T>,
	) => inTransaction({ "app.tenant_id": tenant.id }, fn);
	const asRelay = <T>(fn: (query: Query) => Promise<T>) =>
		inTransaction({ "app.event_relay": "on" }, fn);

	const seed = (tenant: TestTenant) =>
		inTenant(tenant, async (query) => {
			await query(
				"insert into processed_jobs (tenant_id, key) values ($1, 'job-1')",
				[tenant.id],
			);
			const event = await query(
				`insert into domain_events (tenant_id, type, payload) values ($1, 'product.created', '{"productId": "x"}') returning id`,
				[tenant.id],
			);
			return event.rows[0].id as string;
		});

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await app.connect();
		tenantA = await fixtures.tenant();
		tenantB = await fixtures.tenant();
		await seed(tenantA);
		eventB = await seed(tenantB);
	});

	afterAll(async () => {
		// Deleting the tenants must cascade through every event table.
		await fixtures.close();
		await app.end();
	});

	it("protects every event table with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = any($1)",
			[eventTables],
		);
		expect(tables.rows).toHaveLength(eventTables.length);
		for (const row of tables.rows) {
			expect(row, row.table).toMatchObject({ rls: true, forced: true });
		}
	});

	it.each(eventTables)("shows %s only to its tenant", async (table) => {
		const seen = await inTenant(tenantA, (query) =>
			query(`select distinct tenant_id from ${table}`),
		);
		expect(seen.rows).toEqual([{ tenant_id: tenantA.id }]);
	});

	it("shows no event row outside a tenant transaction", async () => {
		for (const table of eventTables) {
			expect((await app.query(`select * from ${table}`)).rows).toEqual(
				[],
			);
		}
	});

	it("runs each job once per tenant", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(
					"insert into processed_jobs (tenant_id, key) values ($1, 'job-1')",
					[tenantA.id],
				),
			),
		).rejects.toMatchObject({ code: "23505" });
	});

	it("lets the relay read and dispatch every tenant's events, and nothing else", async () => {
		const seen = await asRelay((query) =>
			query(
				"select distinct tenant_id from domain_events where tenant_id = any($1)",
				[[tenantA.id, tenantB.id]],
			),
		);
		expect(seen.rows).toHaveLength(2);
		const dispatched = await asRelay((query) =>
			query(
				"update domain_events set dispatched_at = now() where id = $1 returning id",
				[eventB],
			),
		);
		expect(dispatched.rows).toEqual([{ id: eventB }]);
		await expect(
			asRelay((query) =>
				query(
					"insert into domain_events (tenant_id, type, payload) values ($1, 'product.created', '{}')",
					[tenantB.id],
				),
			),
		).rejects.toMatchObject({ code: "42501" });
		const jobs = await asRelay((query) =>
			query("select * from processed_jobs"),
		);
		expect(jobs.rows).toEqual([]);
	});

	it("never lets the application change an event's content or remove it", async () => {
		for (const statement of [
			"update domain_events set payload = '{}'",
			"update domain_events set type = 'other'",
			"delete from domain_events",
			"delete from processed_jobs",
		]) {
			await expect(
				inTenant(tenantA, (query) => query(statement)),
			).rejects.toMatchObject({ code: "42501" });
		}
	});

	it("refuses ids other than UUID v7", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(
					"insert into domain_events (id, tenant_id, type, payload) values (gen_random_uuid(), $1, 'product.created', '{}')",
					[tenantA.id],
				),
			),
		).rejects.toMatchObject({ code: "23514" });
	});
});
