import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const apiDir = dirname(import.meta.dirname);
const PASSWORD = "p".repeat(16);
// Port 1 refuses connections: runs that pass validation fail right after.
const OWNER_URL = "postgres://owner:owner@127.0.0.1:1/db";

const runDbRoles = (env: Record<string, string>) => {
	const result = spawnSync(
		process.execPath,
		[join(apiDir, "scripts/db-roles.ts")],
		{
			cwd: apiDir,
			env: { PATH: process.env.PATH, ...env },
			encoding: "utf8",
		},
	);
	return { status: result.status, stderr: result.stderr };
};

describe("db:roles validation", () => {
	it("refuses an application role other than feitio_app", () => {
		const { status, stderr } = runDbRoles({
			DATABASE_URL: `postgres://postgres:${PASSWORD}@127.0.0.1:1/db`,
			MIGRATION_DATABASE_URL: OWNER_URL,
		});
		expect(status).toBe(1);
		expect(stderr).toContain('DATABASE_URL must connect as "feitio_app"');
	});

	it("refuses a password shorter than 16 characters", () => {
		const { status, stderr } = runDbRoles({
			DATABASE_URL: "postgres://feitio_app:short@127.0.0.1:1/db",
			MIGRATION_DATABASE_URL: OWNER_URL,
		});
		expect(status).toBe(1);
		expect(stderr).toContain("must have at least 16 characters");
	});

	it("refuses an empty MIGRATION_DATABASE_URL", () => {
		const { status, stderr } = runDbRoles({
			DATABASE_URL: `postgres://feitio_app:${PASSWORD}@127.0.0.1:1/db`,
			MIGRATION_DATABASE_URL: "",
		});
		expect(status).toBe(1);
		expect(stderr).toContain("MIGRATION_DATABASE_URL is not set");
	});

	it("accepts the pooler's <role>.<project> user name", () => {
		const { status, stderr } = runDbRoles({
			DATABASE_URL: `postgres://feitio_app.project-ref:${PASSWORD}@127.0.0.1:1/db`,
			MIGRATION_DATABASE_URL: OWNER_URL,
		});
		// Validation passed; only the connection to the closed port failed.
		expect(status).not.toBe(0);
		expect(stderr).not.toContain("db:roles:");
		expect(stderr).toContain("ECONNREFUSED");
	});
});
