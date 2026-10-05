import pg from "pg";
import { Fixtures, type TestTenant } from "../fixtures.js";

type Query = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

const newOrder = `insert into orders (tenant_id, token_hash, state) values ($1, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 'awaiting_payment') returning id`;

const newPayment = (status = "pending", amount = 12990, refunded = 0) =>
	`insert into payments (tenant_id, order_id, method, status, amount, refunded, due_date) values ($1, $2, 'pix', '${status}', ${amount}, ${refunded}, current_date) returning id`;

const newAccount = `insert into payment_accounts (tenant_id, gateway_account_id, wallet_id, credential, webhook_token_hash) values ($1, 'acc', 'wallet', 'sealed', 'hash') returning id`;

// Runs against the real PostgreSQL in .env, as the application role.
describe("Payments schema (e2e)", () => {
	let fixtures: Fixtures;
	let app: pg.Client;
	let tenantA: TestTenant;
	let tenantB: TestTenant;
	let orderA: string;
	let orderB: string;
	let paymentA: string;

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
	const order = (tenant: TestTenant) =>
		inTenant(
			tenant,
			async (query) => (await query(newOrder, [tenant.id])).rows[0].id,
		);

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await app.connect();
		tenantA = await fixtures.tenant();
		tenantB = await fixtures.tenant();
		orderA = await order(tenantA);
		orderB = await order(tenantB);
		paymentA = await inTenant(
			tenantA,
			async (query) =>
				(await query(newPayment(), [tenantA.id, orderA])).rows[0].id,
		);
		await inTenant(tenantA, (query) => query(newAccount, [tenantA.id]));
		await inTenant(tenantB, (query) => query(newAccount, [tenantB.id]));
	});

	afterAll(async () => {
		await fixtures.close();
		await app.end();
	});

	it("protects payments and payment accounts with forced RLS", async () => {
		const tables = await fixtures.query(
			"select relname as table, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relname in ('payments', 'payment_accounts') order by relname",
		);
		expect(tables.rows).toEqual([
			{ table: "payment_accounts", rls: true, forced: true },
			{ table: "payments", rls: true, forced: true },
		]);
	});

	it("shows payments and accounts only to their tenant, and none outside a tenant", async () => {
		const seen = await inTenant(tenantA, async (query) => ({
			payments: (await query("select id from payments")).rows,
			accounts: (await query("select tenant_id from payment_accounts"))
				.rows,
		}));
		expect(seen).toEqual({
			payments: [{ id: paymentA }],
			accounts: [{ tenant_id: tenantA.id }],
		});
		expect((await app.query("select * from payments")).rows).toEqual([]);
		expect(
			(await app.query("select * from payment_accounts")).rows,
		).toEqual([]);
	});

	it("refuses a payment of another tenant's order", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(newPayment(), [tenantA.id, orderB]),
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("keeps one account per store", async () => {
		await expect(
			inTenant(tenantA, (query) => query(newAccount, [tenantA.id])),
		).rejects.toMatchObject({ code: "23505" });
	});

	it("keeps one payment under way or paid per order, but any number of failed ones", async () => {
		await expect(
			inTenant(tenantA, (query) =>
				query(newPayment("confirmed"), [tenantA.id, orderA]),
			),
		).rejects.toMatchObject({ code: "23505" });
		await inTenant(tenantA, async (query) => {
			await query(newPayment("failed"), [tenantA.id, orderA]);
			await query(newPayment("failed"), [tenantA.id, orderA]);
		});
	});

	it.each([
		["no amount", 0, 0],
		["a refund past the amount", 1000, 1001],
		["a negative refund", 1000, -1],
	])("refuses %s", async (_, amount, refunded) => {
		await expect(
			inTenant(tenantB, (query) =>
				query(newPayment("failed", amount, refunded), [
					tenantB.id,
					orderB,
				]),
			),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("never lets the application remove a payment or an account", async () => {
		await expect(
			inTenant(tenantA, (query) => query("delete from payments")),
		).rejects.toMatchObject({ code: "42501" });
		await expect(
			inTenant(tenantA, (query) => query("delete from payment_accounts")),
		).rejects.toMatchObject({ code: "42501" });
	});

	it("records payments and refunds in the order's history", async () => {
		await inTenant(tenantA, (query) =>
			query(
				"insert into order_events (tenant_id, order_id, kind, data) values ($1, $2, 'payment', '{}'), ($1, $2, 'refund', '{}')",
				[tenantA.id, orderA],
			),
		);
	});
});
