import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DATABASE, type Database } from "./database.js";
import { DatabaseHealth } from "./database-health.js";
import { schemas } from "./schema.js";

@Module({
	providers: [
		{
			provide: DATABASE,
			useFactory: (): Database => {
				const url = process.env.DATABASE_URL;
				if (!url) {
					throw new Error(
						"DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env or set it in the environment.",
					);
				}
				const pool = new Pool({
					connectionString: url,
					connectionTimeoutMillis: 5_000,
				});
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
