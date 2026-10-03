import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		globals: true,
		name: "api-e2e",
		root: import.meta.dirname,
		include: ["**/*.e2e-spec.ts"],
	},
});
