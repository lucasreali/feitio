import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		name: "admin",
		root: import.meta.dirname,
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
