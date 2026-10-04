import pg from "pg";
import { Fixtures, type TestTenant, type TestUser } from "../fixtures.js";

const customerTables = [
	"customers",
	"customer_addresses",
	"customer_groups",
	"customer_group_members",
	"customer_events",
];

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** One row in every customer table, as the application role in the tenant. */
interface CustomerRows {
	customer: string;
	group: string;
}

const address = (customer: string, extra = "") =>
	`insert into customer_addresses (tenant_id, customer_id, recipient, cep, street, number, neighborhood, city, state${extra ? `, ${extra}` : ""}) values ($1, '${customer}', 'Ana', '01310100', 'Av. Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP'${extra ? ", true" : ""})`;

// Runs against the real PostgreSQL in .env, as the application role.
describe("Customers schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let user: TestUser;
	let rowsA: CustomerRows;
	let rowsB: CustomerRows;

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

	const newCustomer = (query: Query, tenant: TestTenant, email: string) =>
		one(
			query,
			"insert into customers (tenant_id, email, name, phone, tax_id) values ($1, $2, 'Ana', '+5511987654321', '52998224725')",
			[tenant.id, email],
		);

	const seed = (tenant: TestTenant) =>
		inTenant(tenant, async (query) => {
			const t = tenant.id;
			const customer = await newCustomer(
				query,
				tenant,
				"ana@example.com",
			);
			await query(address(customer, "is_default_shipping"), [t]);
			const group = await one(
				query,
				"insert into customer_groups (tenant_id, name) values ($1, 'VIP')",
				[t],
			);
			await query(
				"insert into customer_group_members (tenant_id, group_id, customer_id) values ($1, $2, $3)",
				[t, group, customer],
			);
			await query(
				"insert into customer_events (tenant_id, customer_id, kind, user_id) values ($1, $2, 'created', $3)",
				[t, customer, user.id],
			);
			return { customer, group };
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
		// Deleting the tenants must cascade through every customer table.
		await fixtures.close();
		await app.end();
	});

	it("protects every customer table with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname = any($1)",
			[customerTables],
		);
		expect(tables.rows).toHaveLength(customerTables.length);
		for (const row of tables.rows) {
			expect(row, row.table).toMatchObject({ rls: true, forced: true });
		}
	});

	it.each(customerTables)("shows %s only to its tenant", async (table) => {
		const seen = await inTenant(tenantA, (query) =>
			query(`select distinct tenant_id from ${table}`),
		);
		expect(seen.rows).toEqual([{ tenant_id: tenantA.id }]);
	});

	it("shows no customer row outside a tenant transaction", async () => {
		for (const table of customerTables) {
			expect((await app.query(`select * from ${table}`)).rows).toEqual(
				[],
			);
		}
	});

	it.each([
		[
			"an address of another tenant's customer",
			(_a: CustomerRows, b: CustomerRows) => address(b.customer),
			[],
		],
		[
			"another tenant's customer in a group",
			(a: CustomerRows, b: CustomerRows) =>
				`insert into customer_group_members (tenant_id, group_id, customer_id) values ($1, '${a.group}', '${b.customer}')`,
			[],
		],
		[
			"a customer in another tenant's group",
			(a: CustomerRows, b: CustomerRows) =>
				`insert into customer_group_members (tenant_id, group_id, customer_id) values ($1, '${b.group}', '${a.customer}')`,
			[],
		],
		[
			"a history entry of another tenant's customer",
			(_a: CustomerRows, b: CustomerRows) =>
				`insert into customer_events (tenant_id, customer_id, kind) values ($1, '${b.customer}', 'note')`,
			[],
		],
	])("refuses %s", async (_case, statement) => {
		await expect(
			inTenant(tenantA, (query) =>
				query(statement(rowsA, rowsB), [tenantA.id]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("keeps one customer per e-mail in each store", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				newCustomer(query, tenantA, "ana@example.com"),
			),
		).rejects.toMatchObject({ code: "23505" });
		// tenantB already has its own ana@example.com from the seed.
	});

	it("keeps one default shipping address per customer", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(address(rowsA.customer, "is_default_shipping"), [
					tenantA.id,
				]),
			),
		).rejects.toMatchObject({ code: "23505" });
		await inTenant(tenantA, (query) =>
			query(address(rowsA.customer, "is_default_billing"), [tenantA.id]),
		);
	});

	it.each([
		[
			"an e-mail in capitals",
			"update customers set email = 'Ana@example.com' where id = $1",
		],
		[
			"a phone outside E.164",
			"update customers set phone = '11987654321' where id = $1",
		],
		[
			"a malformed tax id",
			"update customers set tax_id = '123' where id = $1",
		],
		[
			"a malformed CEP",
			"update customer_addresses set cep = '01310-100' where customer_id = $1",
		],
		[
			"a malformed state",
			"update customer_addresses set state = 'sp' where customer_id = $1",
		],
	])("refuses %s", async (_case, statement) => {
		await expect(
			inTenant(tenantA, (query) => query(statement, [rowsA.customer])),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("never lets the application change or remove a history entry", async () => {
		for (const statement of [
			"update customer_events set kind = 'note'",
			"delete from customer_events",
		]) {
			await expect(
				inTenant(tenantA, (query) => query(statement)),
			).rejects.toMatchObject({ code: "42501" });
		}
	});

	it("erases a customer with their addresses, groups and history", async () => {
		await inTenant(tenantA, async (query) => {
			const customer = await newCustomer(
				query,
				tenantA,
				"erase@example.com",
			);
			await query(address(customer), [tenantA.id]);
			await query(
				"insert into customer_group_members (tenant_id, group_id, customer_id) values ($1, $2, $3)",
				[tenantA.id, rowsA.group, customer],
			);
			await query(
				"insert into customer_events (tenant_id, customer_id, kind) values ($1, $2, 'created')",
				[tenantA.id, customer],
			);
			await query("delete from customers where id = $1", [customer]);
			const left = await query(
				"select (select count(*) from customer_addresses where customer_id = $1) + (select count(*) from customer_group_members where customer_id = $1) + (select count(*) from customer_events where customer_id = $1) as rows",
				[customer],
			);
			expect(left.rows).toEqual([{ rows: "0" }]);
		});
	});
});
