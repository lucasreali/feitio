import { NestFactory } from "@nestjs/core";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		new FastifyAdapter(),
	);

	const openApiConfig = new DocumentBuilder()
		.setTitle("Feitio API")
		.setVersion("1.0")
		.build();
	SwaggerModule.setup(
		"docs",
		app,
		() => SwaggerModule.createDocument(app, openApiConfig),
		{ jsonDocumentUrl: "openapi.json" },
	);

	await app.listen(process.env.PORT ?? 3000, "0.0.0.0");
}
await bootstrap();
