import { Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { RedisHealth } from "./redis-health.js";

const logger = new Logger("Redis");

/**
 * Shared Redis-protocol client (Valkey locally), built from REDIS_URL.
 * Inject `Redis` from "ioredis". BullMQ needs its own connections with
 * `maxRetriesPerRequest: null`; do not reuse this client for queues.
 */
@Module({
	providers: [
		{
			provide: Redis,
			useFactory: (): Redis => {
				const url = process.env.REDIS_URL;
				if (!url) {
					throw new Error(
						"REDIS_URL is not set. Copy apps/api/.env.example to apps/api/.env or set it in the environment.",
					);
				}
				// Connects on the first command, so the API starts even before Redis is up.
				const client = new Redis(url, {
					lazyConnect: true,
					connectTimeout: 5_000,
					maxRetriesPerRequest: 1,
				});
				client.on("error", (error) => logger.error(error.message));
				return client;
			},
		},
		RedisHealth,
	],
	exports: [Redis, RedisHealth],
})
export class RedisModule implements OnApplicationShutdown {
	constructor(private readonly redis: Redis) {}

	onApplicationShutdown() {
		this.redis.disconnect();
	}
}
