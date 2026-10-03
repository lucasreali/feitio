import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "sdk",
		root: import.meta.dirname,
		include: ["src/**/*.spec.ts"],
	},
});
