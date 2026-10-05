import pg from "pg";
import { Fixtures, type TestTenant, type TestUser } from "../fixtures.js";

const orderTables = ["orders", "order_lines", "order_events"];

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** One row in every order table, as the application role in the tenant. */
interface OrderRows {
	customer: string;
	variant: string;
	order: string;
}

const newOrder = (extra = "", values = "") =>
	`insert into orders (tenant_id, token_hash${extra}) values ($1, encode(sha256(gen_random_uuid()::text::bytea), 'hex')${values})`;

const newLine = (order: string, variant: string, quantity = 1) =>
	`insert into order_lines (tenant_id, order_id, variant_id, product_name, sku, quantity, unit_price, position) values ($1, '${order}', '${variant}', 'Shirt', 'SHIRT', ${quantity}, 1290, 0)`;

// Runs against the real PostgreSQL in .env.test, as the application role.
describe("Orders schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let user: TestUser;
	let rowsA: OrderRows;
	let rowsB: OrderRows;

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

	/** A product with one variant; answers the variant. */
	const newVariant = async (query: Query, tenant: TestTenant) => {
		const slug = `shirt-${crypto.randomUUID().slice(0, 8)}`;
		const product = await one(
			query,
			"insert into products (tenant_id, name, slug) values ($1, 'Shirt', $2)",
			[tenant.id, slug],
		);
		await one(
			query,
			"insert into product_variants (tenant_id, product_id, sku, price, position) values ($1, $2, $3, 1290, 0)",
			[tenant.id, product, `${slug}-a`],
		);
		return one(
			query,
			"insert into product_variants (tenant_id, product_id, sku, price, position) values ($1, $2, $3, 1290, 1)",
			[tenant.id, product, `${slug}-b`],
		);
	};

	const seed = (tenant: TestTenant) =>
		inTenant(tenant, async (query) => {
			const t = tenant.id;
			const customer = await one(
				query,
				"insert into customers (tenant_id, email, name) values ($1, 'ana@example.com', 'Ana')",
				[t],
			);
			const variant = await newVariant(query, tenant);
			const order = await one(
				query,
				newOrder(", customer_id, number", ", $2, 1"),
				[t, customer],
			);
			await query(newLine(order, variant), [t]);
			await query(
				"insert into order_events (tenant_id, order_id, kind, user_id) values ($1, $2, 'note', $3)",
				[t, order, user.id],
			);
			return { customer, variant, order };
		});

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await app.connect();
		tenantA = await fixtures.tenant();
		tenantB = await fixtures.tenant();
		user = await fixtures.user();
		rowsA = await seed(tenantA);
		rowsB = await seed(tenantB);
	});

	afterAll(async () => {
		// Deleting the tenants must cascade through every order table.
		await fixtures.close();
		await app.end();
	});

	it("protects every order table with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = any($1)",
			[orderTables],
		);
		expect(tables.rows).toHaveLength(orderTables.length);
		for (const row of tables.rows) {
			expect(row, row.table).toMatchObject({ rls: true, forced: true });
		}
	});

	it.each(orderTables)("shows %s only to its tenant", async (table) => {
		const seen = await inTenant(tenantA, (query) =>
			query(`select distinct tenant_id from ${table}`),
		);
		expect(seen.rows).toEqual([{ tenant_id: tenantA.id }]);
	});

	it("shows no order row outside a tenant transaction", async () => {
		for (const table of orderTables) {
			expect((await app.query(`select * from ${table}`)).rows).toEqual(
				[],
			);
		}
	});

	it.each([
		[
			"an order of another tenant's customer",
			(_a: OrderRows, b: OrderRows) =>
				newOrder(", customer_id", `, '${b.customer}'`),
		],
		[
			"a line of another tenant's order",
			(a: OrderRows, b: OrderRows) => newLine(b.order, a.variant),
		],
		[
			"a line of another tenant's variant",
			(a: OrderRows, b: OrderRows) => newLine(a.order, b.variant),
		],
		[
			"a history entry of another tenant's order",
			(_a: OrderRows, b: OrderRows) =>
				`insert into order_events (tenant_id, order_id, kind) values ($1, '${b.order}', 'note')`,
		],
	])("refuses %s", async (_case, statement) => {
		await expect(
			inTenant(tenantA, (query) =>
				query(statement(rowsA, rowsB), [tenantA.id]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("starts an order as a cart without a number, and numbers orders once per store", async () => {
		const order = await inTenant(tenantA, (query) =>
			query(`${newOrder()} returning state, number`, [tenantA.id]),
		);
		expect(order.rows).toEqual([{ state: "cart", number: null }]);
		await expect(
			inTenant(tenantA, (query) =>
				query(newOrder(", number", ", 1"), [tenantA.id]),
			),
		).rejects.toMatchObject({ code: "23505" });
		// tenantB already has its own order 1 from the seed.
	});

	it("keeps one line per variant in an order", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(newLine(rowsA.order, rowsA.variant), [tenantA.id]),
			),
		).rejects.toMatchObject({ code: "23505" });
	});

	it.each([
		[
			"a line of no units",
			"update order_lines set quantity = 0 where order_id = $1",
		],
		[
			"a negative unit price",
			"update order_lines set unit_price = -1 where order_id = $1",
		],
		[
			"a total that does not add up",
			"update orders set subtotal = 1000, total = 900 where id = $1",
		],
		[
			"a negative total",
			"update orders set discount = 100, total = -100 where id = $1",
		],
		["an order number of 0", "update orders set number = 0 where id = $1"],
	])("refuses %s", async (_case, statement) => {
		await expect(
			inTenant(tenantA, (query) => query(statement, [rowsA.order])),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("never lets the application change or remove a history entry", async () => {
		for (const statement of [
			"update order_events set kind = 'note'",
			"delete from order_events",
		]) {
			await expect(
				inTenant(tenantA, (query) => query(statement)),
			).rejects.toMatchObject({ code: "42501" });
		}
	});

	it("keeps an order and its lines when the customer and the variant go away", async () => {
		await inTenant(tenantA, async (query) => {
			const customer = await one(
				query,
				"insert into customers (tenant_id, email, name) values ($1, 'gone@example.com', 'Gone')",
				[tenantA.id],
			);
			const variant = await newVariant(query, tenantA);
			const order = await one(query, newOrder(", customer_id", ", $2"), [
				tenantA.id,
				customer,
			]);
			await query(newLine(order, variant), [tenantA.id]);

			await query("delete from customers where id = $1", [customer]);
			await query("delete from product_variants where id = $1", [
				variant,
			]);

			const kept = await query(
				"select o.tenant_id, o.customer_id, l.tenant_id as line_tenant_id, l.variant_id, l.sku from orders o join order_lines l on l.order_id = o.id where o.id = $1",
				[order],
			);
			expect(kept.rows).toEqual([
				{
					tenant_id: tenantA.id,
					customer_id: null,
					line_tenant_id: tenantA.id,
					variant_id: null,
					sku: "SHIRT",
				},
			]);
		});
	});

	it("removes a cart with its lines and history", async () => {
		await inTenant(tenantA, async (query) => {
			const order = await one(query, newOrder(), [tenantA.id]);
			await query(newLine(order, rowsA.variant), [tenantA.id]);
			await query(
				"insert into order_events (tenant_id, order_id, kind) values ($1, $2, 'note')",
				[tenantA.id, order],
			);
			await query("delete from orders where id = $1", [order]);
			const left = await query(
				"select (select count(*) from order_lines where order_id = $1) + (select count(*) from order_events where order_id = $1) as rows",
				[order],
			);
			expect(left.rows).toEqual([{ rows: "0" }]);
		});
	});
});
