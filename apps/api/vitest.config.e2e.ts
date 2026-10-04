import { existsSync } from "node:fs";
import { join } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// The app module needs DATABASE_URL, so e2e tests read the same .env as the API.
const envFile = join(import.meta.dirname, ".env");
if (existsSync(envFile)) {
	process.loadEnvFile(envFile);
}

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		globals: true,
		name: "api-e2e",
		root: import.meta.dirname,
		include: ["**/*.e2e-spec.ts"],
		// Each file holds a few database connections (the API's pool and the
		// fixtures' clients). Supabase's session pooler accepts 15 clients, so
		// more files at once fail with EMAXCONNSESSION.
		maxWorkers: 3,
	},
});
