import pg from "pg";
import { isUuidV7 } from "../src/domain/uuid-v7.js";

// Runs against the real PostgreSQL in MIGRATION_DATABASE_URL (the owner of
// the tables, the only role that writes tenants).
describe("tenant ids (e2e)", () => {
	let owner: pg.Client;
	const created: string[] = [];
	const slug = () => `test-ids-${crypto.randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		await owner.connect();
	});

	afterAll(async () => {
		await owner.query("delete from tenants where id = any($1)", [created]);
		await owner.end();
	});

	it("generates a UUID v7 for a tenant created without an id", async () => {
		const { rows } = await owner.query<{ id: string }>(
			"insert into tenants (name, slug) values ('Ids test', $1) returning id",
			[slug()],
		);
		created.push(rows[0].id);

		expect(isUuidV7(rows[0].id)).toBe(true);
	});

	it("refuses a tenant id of another UUID version", async () => {
		await expect(
			owner.query(
				"insert into tenants (id, name, slug) values ($1, 'Ids test', $2)",
				["0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21", slug()],
			),
		).rejects.toMatchObject({ code: "23514" });
	});
});
