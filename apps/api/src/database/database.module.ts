import {
	Inject,
	Logger,
	Module,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "../config/env.js";
import { DATABASE, type Database } from "./database.js";
import { DatabaseHealth } from "./database-health.js";
import { schemas } from "./schema.js";

const logger = new Logger("Database");

@Module({
	providers: [
		{
			provide: DATABASE,
			useFactory: (): Database => {
				const pool = new Pool({
					connectionString: requireEnv("DATABASE_URL"),
					connectionTimeoutMillis: 5_000,
				});
				// The database (or the pooler) can drop an idle connection at any
				// time. Without a listener that 'error' event crashes the process;
				// the pool already discards the broken connection.
				pool.on("error", (error) => logger.error(error.message));
				return drizzle({ client: pool, schema: schemas });
			},
		},
		DatabaseHealth,
	],
	exports: [DATABASE, DatabaseHealth],
})
export class DatabaseModule implements OnApplicationShutdown {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async onApplicationShutdown() {
		await this.db.$client.end();
	}
}
