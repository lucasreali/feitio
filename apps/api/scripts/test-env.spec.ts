import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTestEnv, unsafeServices } from "./test-env.ts";

const LOCAL = {
	DATABASE_URL: "postgresql://feitio_app:password@localhost:5433/feitio",
	MIGRATION_DATABASE_URL:
		"postgresql://postgres:postgres@127.0.0.1:5433/feitio",
	STORAGE_ENDPOINT: "http://localhost:9100",
	VALKEY_URL: "redis://localhost:6380",
};

describe("unsafeServices", () => {
	it("accepts local services", () => {
		expect(unsafeServices(LOCAL)).toEqual([]);
	});

	it.each([
		[
			"DATABASE_URL",
			"postgresql://feitio_app.ref:pw@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
		],
		[
			"MIGRATION_DATABASE_URL",
			"postgresql://postgres.ref:pw@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
		],
		["STORAGE_ENDPOINT", "https://ref.storage.supabase.co/storage/v1/s3"],
		["VALKEY_URL", "redis://cache.example.com:6380"],
	])("refuses %s on a remote host", (name, value) => {
		expect(unsafeServices({ ...LOCAL, [name]: value })).toEqual([
			expect.stringContaining(name),
		]);
	});

	it("refuses a missing service", () => {
		expect(unsafeServices({ ...LOCAL, DATABASE_URL: undefined })).toEqual([
			expect.stringContaining("DATABASE_URL"),
		]);
	});

	it.each([
		"redis://localhost:6379",
		"redis://localhost",
		"redis://127.0.0.1:6379/0",
	])("refuses the development Valkey's database 0 (%s)", (url) => {
		expect(unsafeServices({ ...LOCAL, VALKEY_URL: url })).toEqual([
			expect.stringContaining("VALKEY_URL"),
		]);
	});

	it("accepts another database on the development Valkey", () => {
		expect(
			unsafeServices({
				...LOCAL,
				VALKEY_URL: "redis://localhost:6379/15",
			}),
		).toEqual([]);
	});
});

describe("loadTestEnv", () => {
	it("fails without .env.test and never falls back to .env", () => {
		const dir = mkdtempSync(join(tmpdir(), "test-env-"));
		writeFileSync(join(dir, ".env"), "TEST_ENV_SENTINEL=dev\n");
		try {
			expect(() => loadTestEnv(dir)).toThrow(/\.env\.test\.example/);
			expect(process.env.TEST_ENV_SENTINEL).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("refuses an .env.test that points at a remote service", () => {
		const dir = mkdtempSync(join(tmpdir(), "test-env-"));
		writeFileSync(
			join(dir, ".env.test"),
			Object.entries({
				...LOCAL,
				STORAGE_ENDPOINT:
					"https://ref.storage.supabase.co/storage/v1/s3",
			})
				.map(([name, value]) => `${name}=${value}`)
				.join("\n"),
		);
		const env = { ...process.env };
		try {
			expect(() => loadTestEnv(dir)).toThrow(/STORAGE_ENDPOINT/);
		} finally {
			process.env = env;
			rmSync(dir, { recursive: true });
		}
	});
});
