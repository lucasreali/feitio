import pg from "pg";
import { Fixtures, type TestTenant } from "../fixtures.js";

const stockTables = ["stock_locations", "stock_levels", "stock_movements"];

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** One row in every stock table, as the application role in the tenant. */
interface StockRows {
	variant: string;
	location: string;
}

// Runs against the real PostgreSQL in .env, as the application role.
describe("Stock schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let rowsA: StockRows;
	let rowsB: StockRows;

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
	const one = async (query: Query, text: string, params: unknown[]) =>
		(await query(`${text} returning id`, params)).rows[0].id as string;

	const seed = (tenant: TestTenant) =>
		inTenant(tenant, async (query) => {
			const t = tenant.id;
			const product = await one(
				query,
				"insert into products (tenant_id, name, slug) values ($1, 'Shirt', 'shirt')",
				[t],
			);
			const variant = await one(
				query,
				"insert into product_variants (tenant_id, product_id, sku, price, position) values ($1, $2, 'SHIRT', 1290, 0)",
				[t, product],
			);
			const location = await one(
				query,
				"insert into stock_locations (tenant_id, name, is_default) values ($1, 'Main', true)",
				[t],
			);
			await query(
				"insert into stock_levels (tenant_id, location_id, variant_id, available) values ($1, $2, $3, 5)",
				[t, location, variant],
			);
			await query(
				"insert into stock_movements (tenant_id, location_id, variant_id, kind, quantity) values ($1, $2, $3, 'adjustment', 5)",
				[t, location, variant],
			);
			return { variant, location };
		});

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await app.connect();
		tenantA = await fixtures.tenant();
		tenantB = await fixtures.tenant();
		rowsA = await seed(tenantA);
		rowsB = await seed(tenantB);
	});

	afterAll(async () => {
		// Deleting the tenants must cascade through every stock table.
		await fixtures.close();
		await app.end();
	});

	it("protects every stock table with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = any($1)",
			[stockTables],
		);
		expect(tables.rows).toHaveLength(stockTables.length);
		for (const row of tables.rows) {
			expect(row, row.table).toMatchObject({ rls: true, forced: true });
		}
	});

	it.each(stockTables)("shows %s only to its tenant", async (table) => {
		const seen = await inTenant(tenantA, (query) =>
			query(`select distinct tenant_id from ${table}`),
		);
		expect(seen.rows).toEqual([{ tenant_id: tenantA.id }]);
	});

	it("shows no stock row outside a tenant transaction", async () => {
		for (const table of stockTables) {
			expect((await app.query(`select * from ${table}`)).rows).toEqual(
				[],
			);
		}
	});

	it.each([
		[
			"a level of another tenant's variant",
			"insert into stock_levels (tenant_id, location_id, variant_id) values ($1, $2, $3)",
			(a: StockRows, b: StockRows) => [a.location, b.variant],
		],
		[
			"a level in another tenant's location",
			"insert into stock_levels (tenant_id, location_id, variant_id) values ($1, $2, $3)",
			(a: StockRows, b: StockRows) => [b.location, a.variant],
		],
		[
			"a movement of another tenant's variant",
			"insert into stock_movements (tenant_id, location_id, variant_id, kind, quantity) values ($1, $2, $3, 'return', 1)",
			(a: StockRows, b: StockRows) => [a.location, b.variant],
		],
	])("refuses %s", async (_case, statement, params) => {
		await expect(
			inTenant(tenantA, (query) =>
				query(statement, [tenantA.id, ...params(rowsA, rowsB)]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("keeps one default location per store, and accepts more locations", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(
					"insert into stock_locations (tenant_id, name, is_default) values ($1, 'Other', true)",
					[tenantA.id],
				),
			),
		).rejects.toMatchObject({ code: "23505" });
		await inTenant(tenantA, (query) =>
			query(
				"insert into stock_locations (tenant_id, name) values ($1, 'Warehouse')",
				[tenantA.id],
			),
		);
	});

	it.each([
		[
			"a negative reserved quantity",
			"update stock_levels set reserved = -1 where variant_id = $1",
		],
		[
			"a movement of zero",
			"insert into stock_movements (tenant_id, location_id, variant_id, kind, quantity) select tenant_id, location_id, variant_id, 'adjustment', 0 from stock_levels where variant_id = $1",
		],
		[
			"a negative reservation",
			"insert into stock_movements (tenant_id, location_id, variant_id, kind, quantity) select tenant_id, location_id, variant_id, 'reservation', -1 from stock_levels where variant_id = $1",
		],
		[
			"a negative low stock threshold",
			"update product_variants set low_stock_threshold = -1 where id = $1",
		],
	])("refuses %s", async (_case, statement) => {
		await expect(
			inTenant(tenantA, (query) => query(statement, [rowsA.variant])),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("never lets the application change or remove a movement", async () => {
		for (const statement of [
			"update stock_movements set quantity = 9",
			"delete from stock_movements",
		]) {
			await expect(
				inTenant(tenantA, (query) => query(statement)),
			).rejects.toMatchObject({ code: "42501" });
		}
	});

	it("tracks stock by default, without selling past it", async () => {
		const variant = await inTenant(tenantA, (query) =>
			query(
				"select track_stock, allow_backorder, low_stock_threshold from product_variants where id = $1",
				[rowsA.variant],
			),
		);
		expect(variant.rows).toEqual([
			{
				track_stock: true,
				allow_backorder: false,
				low_stock_threshold: null,
			},
		]);
	});

	it("removes a variant's stock with the variant", async () => {
		await inTenant(tenantA, async (query) => {
			const product = await one(
				query,
				"insert into products (tenant_id, name, slug) values ($1, 'Cap', 'cap')",
				[tenantA.id],
			);
			const variant = await one(
				query,
				"insert into product_variants (tenant_id, product_id, sku, price, position) values ($1, $2, 'CAP', 500, 0)",
				[tenantA.id, product],
			);
			await query(
				"insert into product_variants (tenant_id, product_id, sku, price, position) values ($1, $2, 'CAP-2', 500, 1)",
				[tenantA.id, product],
			);
			await query(
				"insert into stock_levels (tenant_id, location_id, variant_id, available) values ($1, $2, $3, 1)",
				[tenantA.id, rowsA.location, variant],
			);
			await query(
				"insert into stock_movements (tenant_id, location_id, variant_id, kind, quantity) values ($1, $2, $3, 'adjustment', 1)",
				[tenantA.id, rowsA.location, variant],
			);
			await query("delete from product_variants where id = $1", [
				variant,
			]);
			const left = await query(
				"select (select count(*) from stock_levels where variant_id = $1) + (select count(*) from stock_movements where variant_id = $1) as rows",
				[variant],
			);
			expect(left.rows).toEqual([{ rows: "0" }]);
		});
	});
});
