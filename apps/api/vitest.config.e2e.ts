import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./scripts/test-env.ts";

// .env.test only, never .env; refuses services that are not local, since the
// tests create and delete stores (`pnpm test:e2e:setup` starts them).
loadTestEnv(import.meta.dirname);

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		globals: true,
		name: "api-e2e",
		root: import.meta.dirname,
		include: ["**/*.e2e-spec.ts"],
		// Each file holds up to 5 database connections (the API's pool of 3,
		// see startApp, and the fixtures' 2 clients), well under the local
		// PostgreSQL's 100.
		maxWorkers: 4,
	},
});
