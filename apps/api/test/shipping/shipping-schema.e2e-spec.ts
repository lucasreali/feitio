import pg from "pg";
import { Fixtures, type TestTenant } from "../fixtures.js";

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

const newMethod = (name = "Sedex") =>
	`insert into shipping_methods (tenant_id, name, kind, config) values ($1, '${name}', 'fixed', '{"price": 1500}') returning id`;

const newOrder = (method: string) =>
	`insert into orders (tenant_id, token_hash, shipping_method_id, shipping_method_name) values ($1, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), '${method}', 'Sedex')`;

// Runs against the real PostgreSQL in .env.test, as the application role.
describe("Shipping schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let methodA: string;
	let methodB: string;

	/** Runs statements in one transaction bound to the tenant. */
	const inTenant = async <T>(
		tenant: TestTenant,
		fn: (query: Query) => Promise<T>,
	): Promise<T> => {
		await app.query("begin");
		try {
			await app.query("select set_config('app.tenant_id', $1, true)", [
				tenant.id,
			]);
			const result = await fn((text, params) => app.query(text, params));
			await app.query("commit");
			return result;
		} catch (error) {
			await app.query("rollback");
			throw error;
		}
	};
	const seed = (tenant: TestTenant) =>
		inTenant(
			tenant,
			async (query) =>
				(await query(newMethod(), [tenant.id])).rows[0].id as string,
		);

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await app.connect();
		tenantA = await fixtures.tenant();
		tenantB = await fixtures.tenant();
		methodA = await seed(tenantA);
		methodB = await seed(tenantB);
		// An order on the method: removing the tenant must still cascade.
		await inTenant(tenantA, (query) =>
			query(newOrder(methodA), [tenantA.id]),
		);
	});

	afterAll(async () => {
		await fixtures.close();
		await app.end();
	});

	it("protects shipping methods with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = 'shipping_methods'",
		);
		expect(tables.rows).toEqual([{ rls: true, forced: true }]);
	});

	it("shows shipping methods only to their tenant, and none outside a tenant", async () => {
		const seen = await inTenant(tenantA, (query) =>
			query("select id from shipping_methods"),
		);
		expect(seen.rows).toEqual([{ id: methodA }]);
		expect(
			(await app.query("select * from shipping_methods")).rows,
		).toEqual([]);
	});

	it("refuses an order with another tenant's shipping method", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(newOrder(methodB), [tenantA.id]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("keeps names unique per store, not across stores", async () => {
		await expect(
			inTenant(tenantA, (query) => query(newMethod(), [tenantA.id])),
		).rejects.toMatchObject({ code: "23505" });
	});

	it("never lets the application remove a method", async () => {
		await expect(
			inTenant(tenantA, (query) => query("delete from shipping_methods")),
		).rejects.toMatchObject({ code: "42501" });
	});

	it("refuses a variant of no weight", async () => {
		await expect(
			inTenant(tenantA, async (query) => {
				const product = await query(
					"insert into products (tenant_id, name, slug) values ($1, 'Shirt', $2) returning id",
					[tenantA.id, `shirt-${crypto.randomUUID().slice(0, 8)}`],
				);
				await query(
					"insert into product_variants (tenant_id, product_id, sku, price, position, weight) values ($1, $2, $3, 1290, 0, 0)",
					[
						tenantA.id,
						product.rows[0].id,
						`sku-${crypto.randomUUID().slice(0, 8)}`,
					],
				);
			}),
		).rejects.toMatchObject({ code: "23514" });
	});
});
