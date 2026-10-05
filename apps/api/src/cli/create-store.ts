/**
 * Creates a store with its first owner (`pnpm store:create`), until the
 * internal admin panel exists. Lives in src/ and runs from dist/ so it uses
 * the API's own domain types and password hashing.
 *
 * Tenants and users are written by the owner of the tables
 * (MIGRATION_DATABASE_URL); the store settings and the membership by the
 * application role (DATABASE_URL) inside the new tenant, the path the API
 * takes, so they go through RLS.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { hashPassword } from "../auth/password.js";
import { readConfig } from "../config/config.js";
import type { TenantId } from "../domain/ids.js";
import {
	type CreateStoreInput,
	parseCreateStoreArgs,
} from "./create-store-args.js";

export interface CreatedStore {
	tenantId: TenantId;
	/** Only for a new user: shown once, never stored. */
	password?: string;
}

const UNIQUE_VIOLATION = "23505";

export async function createStore(
	input: CreateStoreInput,
	db: { owner: pg.Client; app: pg.Client },
): Promise<CreatedStore> {
	const { owner, app } = db;
	let tenantId: TenantId;
	let createdUserId: string | undefined;
	let password: string | undefined;

	await owner.query("begin");
	try {
		const existing = await owner.query<{ id: string }>(
			"select id from users where email = $1",
			[input.owner.email],
		);
		if (existing.rows.length === 0) {
			const { name, cpf } = input.owner;
			if (!name || !cpf) {
				throw new Error(
					`${input.owner.email} is not a user yet: give the owner's name and CPF.`,
				);
			}
			password = randomBytes(18).toString("base64url");
			const user = await owner.query<{ id: string }>(
				"insert into users (email, name, cpf, password_hash) values ($1, $2, $3, $4) returning id",
				[input.owner.email, name, cpf, await hashPassword(password)],
			);
			createdUserId = user.rows[0].id;
		}
		const tenant = await owner.query<{ id: TenantId }>(
			"insert into tenants (name, slug) values ($1, $2) returning id",
			[input.name, input.slug],
		);
		tenantId = tenant.rows[0].id;
		await owner.query("commit");
	} catch (error) {
		await owner.query("rollback");
		throw explain(error, input);
	}

	const userId =
		createdUserId ??
		(
			await owner.query<{ id: string }>(
				"select id from users where email = $1",
				[input.owner.email],
			)
		).rows[0].id;
	await app.query("begin");
	try {
		await app.query("select set_config('app.tenant_id', $1, true)", [
			tenantId,
		]);
		await app.query(
			"insert into store_settings (tenant_id, display_name) values ($1, $2)",
			[tenantId, input.name],
		);
		await app.query(
			"insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')",
			[tenantId, userId],
		);
		await app.query("commit");
	} catch (error) {
		await app.query("rollback");
		// Undo the first step, so a retry starts clean.
		await owner.query("delete from tenants where id = $1", [tenantId]);
		if (createdUserId) {
			await owner.query("delete from users where id = $1", [
				createdUserId,
			]);
		}
		throw error;
	}
	return { tenantId, password };
}

function explain(error: unknown, input: CreateStoreInput): unknown {
	if (error instanceof pg.DatabaseError && error.code === UNIQUE_VIOLATION) {
		return new Error(
			error.constraint === "users_cpf_unique"
				? "This CPF already belongs to another user."
				: `The slug "${input.slug}" is already in use.`,
		);
	}
	return error;
}

async function main() {
	if (existsSync(".env")) {
		process.loadEnvFile();
	}
	const input = parseCreateStoreArgs(process.argv.slice(2));
	const config = readConfig(process.env, ["database", "migrations"]);
	const owner = new pg.Client({ connectionString: config.migrations.url });
	const app = new pg.Client({ connectionString: config.database.url });
	await Promise.all([owner.connect(), app.connect()]);
	try {
		const { tenantId, password } = await createStore(input, { owner, app });
		console.log(
			`Store "${input.name}" created: ${input.slug} (${tenantId}).`,
		);
		console.log(
			password
				? `Owner ${input.owner.email} created. Password, shown only now: ${password}`
				: `Existing user ${input.owner.email} is now an owner of this store.`,
		);
	} finally {
		await Promise.all([owner.end(), app.end()]);
	}
}

// Runs only as a command, not when tests import createStore.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error: unknown) => {
		console.error(
			`store:create: ${error instanceof Error ? error.message : error}`,
		);
		process.exit(1);
	});
}
