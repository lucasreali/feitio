import { existsSync } from "node:fs";
import { NestFactory } from "@nestjs/core";
import { startupConfig, WORKER_SECTIONS } from "./config/config.js";
import { WorkerModule } from "./worker.module.js";

if (existsSync(".env")) {
	process.loadEnvFile();
}

// Every variable the worker needs checked at once, before anything connects.
startupConfig(WORKER_SECTIONS);

// No HTTP server: the worker relays domain events and runs their jobs. On
// SIGTERM it stops taking jobs and waits for the running ones.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
