import { Test } from "@nestjs/testing";
import pg from "pg";
import { DATABASE, type Database } from "../src/database/database.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { DatabaseHealth } from "../src/database/database-health.js";

// Runs against the real PostgreSQL in DATABASE_URL.
describe("DatabaseModule (e2e)", () => {
	it("survives the database dropping an idle connection", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [DatabaseModule],
		}).compile();
		const pool = moduleRef.get<Database>(DATABASE).$client;
		const health = moduleRef.get(DatabaseHealth);

		// Leaves one idle connection in the pool and learns its server process.
		const { rows } = await pool.query<{ pid: number }>(
			"select pg_backend_pid() as pid",
		);
		const other = new pg.Client({
			connectionString: process.env.DATABASE_URL,
		});
		await other.connect();
		await other.query("select pg_terminate_backend($1)", [rows[0].pid]);
		await other.end();
		await new Promise((resolve) => setTimeout(resolve, 500));

		await expect(health.isReachable()).resolves.toBe(true);
		await moduleRef.close();
	});
});
