import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) {
	process.loadEnvFile();
}

const url = process.env.DATABASE_URL;
if (!url) {
	throw new Error(
		"DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env or set it in the environment.",
	);
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/database/schemas",
	out: "./drizzle",
	dbCredentials: { url },
});
