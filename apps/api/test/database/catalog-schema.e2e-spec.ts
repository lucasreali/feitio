import pg from "pg";
import { Fixtures, type TestTenant } from "../fixtures.js";

const catalogTables = [
	"assets",
	"products",
	"product_images",
	"product_option_groups",
	"product_options",
	"product_variants",
	"product_variant_options",
	"facets",
	"facet_values",
	"product_facet_values",
	"collections",
	"collection_products",
	"collection_facet_values",
];

/** One row in every catalog table, as the application role in the tenant. */
interface CatalogRows {
	asset: string;
	product: string;
	group: string;
	option: string;
	variant: string;
	facetValue: string;
	collection: string;
}

// Runs against the real PostgreSQL in .env, as the application role.
describe("Catalog schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let rowsA: CatalogRows;
	let rowsB: CatalogRows;

	/** Runs statements in one transaction bound to the tenant. */
	const inTenant = async <T>(
		tenant: TestTenant,
		fn: (
			query: (
				text: string,
				params?: unknown[],
			) => Promise<pg.QueryResult>,
		) => Promise<T>,
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
	const one = async (
		query: (text: string, params?: unknown[]) => Promise<pg.QueryResult>,
		text: string,
		params: unknown[],
	) => (await query(`${text} returning id`, params)).rows[0].id as string;

	const seed = (tenant: TestTenant) =>
		inTenant(tenant, async (query) => {
			const t = tenant.id;
			const asset = await one(
				query,
				"insert into assets (tenant_id, key) values ($1, $2)",
				[t, `tenants/${t}/assets/${crypto.randomUUID()}.png`],
			);
			const product = await one(
				query,
				"insert into products (tenant_id, name, slug) values ($1, 'Shirt', 'shirt')",
				[t],
			);
			await query(
				"insert into product_images (tenant_id, product_id, asset_id, position) values ($1, $2, $3, 0)",
				[t, product, asset],
			);
			const group = await one(
				query,
				"insert into product_option_groups (tenant_id, product_id, name) values ($1, $2, 'Size')",
				[t, product],
			);
			const option = await one(
				query,
				"insert into product_options (tenant_id, product_id, group_id, name) values ($1, $2, $3, 'M')",
				[t, product, group],
			);
			const variant = await one(
				query,
				"insert into product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'SHIRT-M', 1290)",
				[t, product],
			);
			await query(
				"insert into product_variant_options (tenant_id, product_id, variant_id, group_id, option_id) values ($1, $2, $3, $4, $5)",
				[t, product, variant, group, option],
			);
			const facet = await one(
				query,
				"insert into facets (tenant_id, name) values ($1, 'Brand')",
				[t],
			);
			const facetValue = await one(
				query,
				"insert into facet_values (tenant_id, facet_id, name) values ($1, $2, 'Aurora')",
				[t, facet],
			);
			await query(
				"insert into product_facet_values (tenant_id, product_id, facet_value_id) values ($1, $2, $3)",
				[t, product, facetValue],
			);
			const collection = await one(
				query,
				"insert into collections (tenant_id, name, slug, kind, position) values ($1, 'Shirts', 'shirts', 'manual', 0)",
				[t],
			);
			await query(
				"insert into collection_products (tenant_id, collection_id, product_id, position) values ($1, $2, $3, 0)",
				[t, collection, product],
			);
			const rule = await one(
				query,
				"insert into collections (tenant_id, name, slug, kind, position) values ($1, 'Aurora', 'aurora', 'rule', 1)",
				[t],
			);
			await query(
				"insert into collection_facet_values (tenant_id, collection_id, facet_value_id) values ($1, $2, $3)",
				[t, rule, facetValue],
			);
			return {
				asset,
				product,
				group,
				option,
				variant,
				facetValue,
				collection,
			};
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
		// Deleting the tenants must cascade through every catalog table.
		await fixtures.close();
		await app.end();
	});

	it("protects every table with a tenant_id with forced RLS and tenant-bound foreign keys", async () => {
		const tables = await fixtures.query(`
			select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced
			from pg_class c
			join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
			where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`);
		for (const name of catalogTables) {
			expect(tables.rows).toContainEqual({
				table: name,
				rls: true,
				forced: true,
			});
		}
		for (const row of tables.rows) {
			expect(row, row.table).toMatchObject({ rls: true, forced: true });
		}

		// FK checks skip RLS: a reference between two tenant tables that leaves
		// tenant_id out could reach another tenant's row.
		const plain = await fixtures.query(`
			select con.conname
			from pg_constraint con
			join pg_attribute tenant on tenant.attrelid = con.conrelid and tenant.attname = 'tenant_id'
			join pg_attribute target on target.attrelid = con.confrelid and target.attname = 'tenant_id'
			where con.contype = 'f' and not tenant.attnum = any(con.conkey)`);
		expect(plain.rows).toEqual([]);
	});

	it.each(catalogTables)("shows %s only to its tenant", async (table) => {
		const seen = await inTenant(tenantA, (query) =>
			query(`select distinct tenant_id from ${table}`),
		);
		expect(seen.rows).toEqual([{ tenant_id: tenantA.id }]);
	});

	it("shows no catalog row outside a tenant transaction", async () => {
		for (const table of catalogTables) {
			expect((await app.query(`select * from ${table}`)).rows).toEqual(
				[],
			);
		}
	});

	it.each([
		[
			"an image of another tenant's asset",
			"insert into product_images (tenant_id, product_id, asset_id, position) values ($1, $2, $3, 1)",
			(a: CatalogRows, b: CatalogRows) => [a.product, b.asset],
		],
		[
			"a variant of another tenant's product",
			"insert into product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'X', 1)",
			(_a: CatalogRows, b: CatalogRows) => [b.product],
		],
		[
			"a facet value of another tenant on a product",
			"insert into product_facet_values (tenant_id, product_id, facet_value_id) values ($1, $2, $3)",
			(a: CatalogRows, b: CatalogRows) => [a.product, b.facetValue],
		],
		[
			"a collection under another tenant's collection",
			"insert into collections (tenant_id, name, slug, kind, position, parent_id) values ($1, 'x', 'x', 'manual', 9, $2)",
			(_a: CatalogRows, b: CatalogRows) => [b.collection],
		],
	])("refuses %s", async (_case, statement, params) => {
		await expect(
			inTenant(tenantA, (query) =>
				query(statement, [tenantA.id, ...params(rowsA, rowsB)]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("refuses a variant option from another product of the same tenant", async () => {
		await expect(
			inTenant(tenantA, async (query) => {
				const other = await one(
					query,
					"insert into products (tenant_id, name, slug) values ($1, 'Cap', 'cap')",
					[tenantA.id],
				);
				const variant = await one(
					query,
					"insert into product_variants (tenant_id, product_id, sku, price) values ($1, $2, 'CAP', 500)",
					[tenantA.id, other],
				);
				await query(
					"insert into product_variant_options (tenant_id, product_id, variant_id, group_id, option_id) values ($1, $2, $3, $4, $5)",
					[tenantA.id, other, variant, rowsA.group, rowsA.option],
				);
			}),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("refuses to commit a product without variants", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(
					"insert into products (tenant_id, name, slug) values ($1, 'Empty', 'empty')",
					[tenantA.id],
				),
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			inTenant(tenantA, (query) =>
				query("delete from product_variants where id = $1", [
					rowsA.variant,
				]),
			),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("refuses a negative price", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query("update product_variants set price = -1 where id = $1", [
					rowsA.variant,
				]),
			),
		).rejects.toMatchObject({ code: "23514" });
	});
});
