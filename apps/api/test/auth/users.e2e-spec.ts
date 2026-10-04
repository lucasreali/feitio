import pg from "pg";
import { isUuidV7 } from "../../src/domain/uuid-v7.js";
import { randomCpf } from "../fixtures.js";

// Users are platform rows, shared by every tenant: written by the owner of
// the tables (MIGRATION_DATABASE_URL), only read by the application role.
describe("users table (e2e)", () => {
	let owner: pg.Client;
	let app: pg.Client;
	const created: string[] = [];
	const email = () => {
		const address = `test-${crypto.randomUUID()}@feitio.test`;
		created.push(address);
		return address;
	};
	const insert = (
		client: pg.Client,
		address: string,
		{ id, cpf = randomCpf() }: { id?: string; cpf?: string } = {},
	) =>
		client.query<{ id: string }>(
			`insert into users (${id ? "id, " : ""}email, name, cpf, password_hash)
			 values (${id ? "$5, " : ""}$1, $2, $3, $4) returning id`,
			id ? [address, "Test", cpf, "x", id] : [address, "Test", cpf, "x"],
		);

	beforeAll(async () => {
		owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		app = new pg.Client({ connectionString: process.env.DATABASE_URL });
		await Promise.all([owner.connect(), app.connect()]);
	});

	afterAll(async () => {
		// Only this file's rows: other e2e files run in parallel.
		await owner.query("delete from users where email = any($1)", [created]);
		await Promise.all([owner.end(), app.end()]);
	});

	it("generates a UUID v7 id and refuses other versions", async () => {
		const { rows } = await insert(owner, email());
		expect(isUuidV7(rows[0].id)).toBe(true);

		await expect(
			insert(owner, email(), {
				id: "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21",
			}),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("keeps e-mails unique and lowercase", async () => {
		const address = email();
		await insert(owner, address);

		await expect(insert(owner, address)).rejects.toMatchObject({
			code: "23505",
		});
		await expect(
			insert(owner, address.toUpperCase()),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("requires a CPF, unique and stored as its 11 digits", async () => {
		const cpf = randomCpf();
		await insert(owner, email(), { cpf });

		await expect(insert(owner, email(), { cpf })).rejects.toMatchObject({
			code: "23505",
		});
		const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
		await expect(
			insert(owner, email(), { cpf: formatted }),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			owner.query(
				"insert into users (email, name, password_hash) values ($1, 'Test', 'x')",
				[email()],
			),
		).rejects.toMatchObject({ code: "23502" });
	});

	it("lets the application role read users but not write them", async () => {
		const address = email();
		await insert(owner, address);

		const { rows } = await app.query(
			"select email from users where email = $1",
			[address],
		);
		expect(rows).toEqual([{ email: address }]);
		await expect(insert(app, email())).rejects.toMatchObject({
			code: "42501",
		});
		await expect(
			app.query("update users set name = 'x' where email = $1", [
				address,
			]),
		).rejects.toMatchObject({ code: "42501" });
	});
});
