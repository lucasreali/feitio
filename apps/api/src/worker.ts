import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

if (existsSync(".env")) {
	process.loadEnvFile();
}

// No HTTP server: the worker relays domain events and runs their jobs. On
// SIGTERM it stops taking jobs and waits for the running ones.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
