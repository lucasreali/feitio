/**
 * Creates two example tenants with different store settings for local
 * development (`pnpm db:seed`). Safe to run again: it updates them in place.
 *
 * Tenants are written by the owner (MIGRATION_DATABASE_URL); store settings by
 * the application user (DATABASE_URL) inside each tenant's transaction, the
 * same path the API takes, so the seed also goes through RLS.
 */
import { existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) {
	process.loadEnvFile();
}

// Scripts run as .ts files straight under Node, which cannot load src/ (its
// imports name the .js files the build emits), so they keep this small copy
// of src/config/env.ts instead of importing requireEnv.
const env = (name: string) => {
	const value = process.env[name];
	if (!value) {
		console.error(
			`db:seed: ${name} is not set (see apps/api/.env.example).`,
		);
		process.exit(1);
	}
	return value;
};

const exampleTenants = [
	{
		slug: "loja-aurora",
		name: "Aurora Ateliê",
		logoUrl: "https://placehold.co/160x48?text=Aurora",
		theme: {
			background: "#FFF8F0",
			foreground: "#2B1D14",
			primary: "#C2410C",
			"primary-foreground": "#FFF8F0",
			muted: "#F5E9DD",
			"muted-foreground": "#7A5C45",
			accent: "#F59E0B",
			border: "#EAD7C3",
			destructive: "#B91C1C",
			radius: "0.75rem",
		},
	},
	{
		slug: "loja-brisa",
		name: "Brisa Moda Praia",
		logoUrl: "https://placehold.co/160x48?text=Brisa",
		theme: {
			background: "#F4FBFC",
			foreground: "#0F2A33",
			primary: "#0E7490",
			"primary-foreground": "#F0FDFF",
			muted: "#E0F2F5",
			"muted-foreground": "#4B6B75",
			accent: "#22D3EE",
			border: "#CDE8EE",
			destructive: "#BE123C",
			radius: "1rem",
		},
	},
];

const owner = new pg.Client({
	connectionString: env("MIGRATION_DATABASE_URL"),
});
const app = new pg.Client({ connectionString: env("DATABASE_URL") });
await Promise.all([owner.connect(), app.connect()]);
try {
	for (const tenant of exampleTenants) {
		const { rows } = await owner.query<{ id: string }>(
			`insert into tenants (name, slug, status) values ($1, $2, 'active')
			 on conflict (slug) do update set name = excluded.name, status = 'active', updated_at = now()
			 returning id`,
			[tenant.name, tenant.slug],
		);
		const tenantId = rows[0].id;

		await app.query("begin");
		try {
			await app.query("select set_config('app.tenant_id', $1, true)", [
				tenantId,
			]);
			await app.query(
				`insert into store_settings (tenant_id, display_name, logo_url, theme) values ($1, $2, $3, $4)
				 on conflict (tenant_id) do update set display_name = excluded.display_name,
				   logo_url = excluded.logo_url, theme = excluded.theme, updated_at = now()`,
				[tenantId, tenant.name, tenant.logoUrl, tenant.theme],
			);
			await app.query("commit");
		} catch (error) {
			await app.query("rollback");
			throw error;
		}
		console.log(`db:seed: ${tenant.slug} (${tenantId})`);
	}
} finally {
	await Promise.all([owner.end(), app.end()]);
}
