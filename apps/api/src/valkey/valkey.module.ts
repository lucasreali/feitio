import { Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Valkey } from "./valkey.js";
import { ValkeyHealth } from "./valkey-health.js";

const logger = new Logger("Valkey");

/**
 * Shared client for Valkey, built from VALKEY_URL. Inject `Valkey` from
 * `./valkey.js`. BullMQ needs its own connections with
 * `maxRetriesPerRequest: null`; do not reuse this client for queues.
 */
@Module({
	providers: [
		{
			provide: Valkey,
			useFactory: (): Valkey => {
				const url = process.env.VALKEY_URL;
				if (!url) {
					throw new Error(
						"VALKEY_URL is not set. Copy apps/api/.env.example to apps/api/.env or set it in the environment.",
					);
				}
				// Connects on the first command, so the API starts even before Valkey is up.
				const client = new Valkey(url, {
					lazyConnect: true,
					connectTimeout: 5_000,
					maxRetriesPerRequest: 1,
				});
				client.on("error", (error) => logger.error(error.message));
				return client;
			},
		},
		ValkeyHealth,
	],
	exports: [Valkey, ValkeyHealth],
})
export class ValkeyModule implements OnApplicationShutdown {
	constructor(private readonly valkey: Valkey) {}

	onApplicationShutdown() {
		this.valkey.disconnect();
	}
}
