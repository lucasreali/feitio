import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { API_SECTIONS, startupConfig } from "./config/config.js";

if (existsSync(".env")) {
	process.loadEnvFile();
}

// Every variable checked at once, before anything connects.
const config = startupConfig(API_SECTIONS);

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter(),
	);
	await configureApp(app);

	await app.listen(config.server.port, "0.0.0.0");
}
await bootstrap();
