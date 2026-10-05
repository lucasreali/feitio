import { setTimeout as sleep } from "node:timers/promises";
import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { orders } from "../database/schemas/orders.js";
import { payments } from "../database/schemas/payments.js";
import { tenants } from "../database/schemas/tenants.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import { transitionOrder } from "./order-transitions.js";

const logger = new Logger("OrderExpiry");

const HOUR = 60 * 60 * 1000;

/**
 * An order awaiting payment this long after its last change is cancelled,
 * and its reserved stock goes back on sale, unless a payment of it is still
 * under way (see CLEARING_DAYS).
 */
const UNPAID_FOR = 24 * HOUR;

/**
 * Days after its due date that a pending payment still holds its order: a
 * boleto paid on the last day takes up to 3 business days to clear.
 *
 * ponytail: calendar days, counted in the database's time zone; business
 * days if a long weekend ever cancels a paid boleto's order.
 */
const CLEARING_DAYS = 5;

/** A cart untouched this long is removed. It holds no stock. */
const CART_IDLE_FOR = 30 * 24 * HOUR;

/**
 * Cancels unpaid orders and removes abandoned carts of every active store
 * (in the worker process only), every minute. Each store runs in its own
 * tenant context, so RLS still limits every query to one store.
 *
 * ponytail: a pass reads every active store; one query across stores (with
 * a policy like the event relay's) when there are many.
 */
@Injectable()
export class OrderExpiry
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private running?: Promise<void>;
	private stopped = false;

	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly tenantDb: TenantDatabase,
	) {}

	onApplicationBootstrap() {
		this.running = this.loop();
	}

	async onApplicationShutdown() {
		this.stopped = true;
		await this.running;
	}

	/** One pass over every active store. A store that fails is logged and skipped. */
	async expire(now = new Date()): Promise<void> {
		const stores = await this.db
			.select({ id: tenants.id, slug: tenants.slug })
			.from(tenants)
			.where(eq(tenants.status, "active"));
		for (const store of stores) {
			try {
				await TenantContext.run(store, () => this.expireStore(now));
			} catch (error) {
				logger.error(
					`Expiry failed for ${store.slug}: ${(error as Error).message}`,
				);
			}
		}
	}

	private async expireStore(now: Date) {
		const unpaid = and(
			eq(orders.state, "awaiting_payment"),
			lt(orders.updatedAt, new Date(now.getTime() - UNPAID_FOR)),
			sql`not exists (select 1 from ${payments} where ${payments.orderId} = ${orders.id} and ${payments.status} = 'pending' and ${payments.dueDate} >= current_date - ${CLEARING_DAYS}::int)`,
		);
		const stale = await this.tenantDb.run((tx) =>
			tx.select({ id: orders.id }).from(orders).where(unpaid),
		);
		// One transaction per order, so one that fails leaves the others.
		for (const { id } of stale) {
			await this.tenantDb.run(async (tx) => {
				// Paid or changed since it was read: no longer stale.
				const [still] = await tx
					.select({ id: orders.id })
					.from(orders)
					.where(and(eq(orders.id, id), unpaid))
					.for("update");
				if (still) {
					await transitionOrder(tx, id, "cancelled", {
						party: "system",
					});
				}
			});
		}
		await this.tenantDb.run((tx) =>
			tx
				.delete(orders)
				.where(
					and(
						eq(orders.state, "cart"),
						lt(
							orders.updatedAt,
							new Date(now.getTime() - CART_IDLE_FOR),
						),
					),
				),
		);
	}

	private async loop() {
		while (!this.stopped) {
			try {
				await this.expire();
			} catch (error) {
				logger.error(`Expiry failed: ${(error as Error).message}`);
			}
			// Short naps, so shutdown does not wait a whole minute.
			for (let i = 0; i < 60 && !this.stopped; i++) {
				await sleep(1_000);
			}
		}
	}
}
