import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";

if (existsSync(".env")) {
	process.loadEnvFile();
}

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter(),
	);
	await configureApp(app);

	await app.listen(process.env.PORT ?? 3000, "0.0.0.0");
}
await bootstrap();
