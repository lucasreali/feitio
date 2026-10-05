/**
 * The e2e suite's environment: apps/api/.env.test, never .env. Read by
 * vitest.config.e2e.ts and scripts/e2e-setup.ts, which refuse to run against
 * anything but local services: the tests create and delete stores.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_SERVICES = [
	"DATABASE_URL",
	"MIGRATION_DATABASE_URL",
	"STORAGE_ENDPOINT",
	"VALKEY_URL",
];
// docker-compose.yml's Valkey, whose database 0 holds development sessions.
const DEV_VALKEY_PORT = "6379";

/** What in `env` could reach a service that is not local and disposable. */
export function unsafeServices(env: Env): string[] {
	const problems: string[] = [];
	for (const name of LOCAL_SERVICES) {
		const value = env[name];
		const url = value && URL.canParse(value) ? new URL(value) : null;
		if (!url || !LOCAL_HOSTS.has(url.hostname)) {
			problems.push(`${name} must point to localhost or 127.0.0.1.`);
		}
	}
	const valkey = URL.canParse(env.VALKEY_URL ?? "")
		? new URL(env.VALKEY_URL as string)
		: null;
	if (
		valkey &&
		(valkey.port || DEV_VALKEY_PORT) === DEV_VALKEY_PORT &&
		Number(valkey.pathname.slice(1) || 0) === 0
	) {
		problems.push(
			"VALKEY_URL must not be database 0 of the development Valkey (port 6379).",
		);
	}
	return problems;
}

/**
 * Loads `dir`/.env.test over the process's environment and checks it. Throws
 * when the file is missing or points anywhere unsafe.
 */
export function loadTestEnv(dir: string): void {
	const file = join(dir, ".env.test");
	if (!existsSync(file)) {
		throw new Error(
			`${file} is missing. Copy apps/api/.env.test.example to apps/api/.env.test; the e2e suite never reads .env.`,
		);
	}
	Object.assign(process.env, parseEnv(readFileSync(file, "utf8")));
	const problems = unsafeServices(process.env);
	if (problems.length > 0) {
		throw new Error(
			[
				"Refusing to run the e2e suite against these services:",
				...problems.map((problem) => `- ${problem}`),
				`Fix ${file}.`,
			].join("\n"),
		);
	}
}
