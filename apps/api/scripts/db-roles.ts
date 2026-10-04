/**
 * Creates or updates the application database role (`pnpm db:roles`).
 *
 * Runs as the owner of the tables (MIGRATION_DATABASE_URL) and takes the
 * role's name and password from DATABASE_URL, so no password is ever written
 * to a migration. Run it before `db:migrate`, which grants this role access.
 */
import { existsSync } from "node:fs";
import pg from "pg";

// Must match APP_ROLE in src/database/roles.ts, the role the migrations name.
const APP_ROLE = "feitio_app";
const MIN_PASSWORD_LENGTH = 16;

if (existsSync(".env")) {
	process.loadEnvFile();
}

function fail(message: string): never {
	console.error(`db:roles: ${message}`);
	process.exit(1);
}

const env = (name: string) =>
	process.env[name] ||
	fail(`${name} is not set (see apps/api/.env.example).`);

const appUrl = new URL(env("DATABASE_URL"));
// Poolers such as Supavisor take "<role>.<project>" as the user name.
const roleName = decodeURIComponent(appUrl.username).split(".")[0];
const password = decodeURIComponent(appUrl.password);
if (roleName !== APP_ROLE) {
	fail(`DATABASE_URL must connect as "${APP_ROLE}", not "${roleName}".`);
}
if (password.length < MIN_PASSWORD_LENGTH) {
	fail(
		`the DATABASE_URL password must have at least ${MIN_PASSWORD_LENGTH} characters.`,
	);
}

const client = new pg.Client({
	connectionString: env("MIGRATION_DATABASE_URL"),
});
await client.connect();
try {
	const existing = await client.query(
		"select 1 from pg_roles where rolname = $1",
		[APP_ROLE],
	);
	const verb = existing.rowCount ? "ALTER" : "CREATE";
	// No superuser, no RLS bypass, no role or database creation.
	const { rows } = await client.query<{ statement: string }>(
		`select format('${verb} ROLE %I WITH LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', $1::text, $2::text) as statement`,
		[APP_ROLE, password],
	);
	await client.query(rows[0].statement);
	const grant = await client.query<{ statement: string }>(
		"select format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) as statement",
		[APP_ROLE],
	);
	await client.query(grant.rows[0].statement);

	const role = await client.query(
		"select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = $1",
		[APP_ROLE],
	);
	console.log(
		`db:roles: ${verb === "CREATE" ? "created" : "updated"}`,
		role.rows[0],
	);
} finally {
	await client.end();
}
