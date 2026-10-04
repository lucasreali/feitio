import { Test } from "@nestjs/testing";
import { DatabaseModule } from "./database.module.js";
import { DatabaseHealth } from "./database-health.js";

describe("DatabaseModule", () => {
	const saved = process.env.DATABASE_URL;

	afterEach(() => {
		process.env.DATABASE_URL = saved;
	});

	const compile = () =>
		Test.createTestingModule({ imports: [DatabaseModule] }).compile();

	it("fails at startup without DATABASE_URL", async () => {
		delete process.env.DATABASE_URL;
		await expect(compile()).rejects.toThrow("DATABASE_URL is not set.");
	});

	it("reports an unreachable database as down", async () => {
		// Port 1 refuses connections immediately.
		process.env.DATABASE_URL = "postgres://user:password@127.0.0.1:1/db";
		const moduleRef = await compile();

		await expect(moduleRef.get(DatabaseHealth).isReachable()).resolves.toBe(
			false,
		);
		await moduleRef.close();
	});
});
