import { pluginFetch } from "@kubb/plugin-fetch";
import { pluginReactQuery } from "@kubb/plugin-react-query";
import { pluginTs } from "@kubb/plugin-ts";
import { pluginZod } from "@kubb/plugin-zod";
import { defineConfig } from "kubb/config";

// Generates the API client from the OpenAPI spec served by apps/api (`pnpm api:generate`).
export default defineConfig({
	input: process.env.OPENAPI_URL ?? "http://localhost:3000/openapi.json",
	output: { path: "./src/api/gen", clean: true },
	plugins: [
		pluginTs(),
		pluginZod(),
		pluginFetch({
			// Kubb emits this as a template literal, so the URL is read at runtime.
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Kubb interpolation syntax
			baseURL: "${import.meta.env.VITE_API_URL}",
		}),
		pluginReactQuery(),
	],
});
