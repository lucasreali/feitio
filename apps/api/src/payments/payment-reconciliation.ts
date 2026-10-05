import { setTimeout as sleep } from "node:timers/promises";
import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { payments } from "../database/schemas/payments.js";
import { tenants } from "../database/schemas/tenants.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import { PaymentAccounts } from "./payment-accounts.js";
import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-gateway.js";
import { failPayment, settlePayment } from "./settle-payment.js";

const logger = new Logger("PaymentReconciliation");

const MINUTE = 60 * 1000;

/** A pending payment younger than this may still get its notification. */
const CHECK_AFTER = 10 * MINUTE;

/** A payment the gateway still does not know this long after is failed. */
const GIVE_UP_AFTER = 30 * MINUTE;

/** Time between passes. */
const EVERY = 5 * MINUTE;

/**
 * Checks pending payments with the gateway, for notifications that never
 * came (in the worker process only), every 5 minutes: each is settled as
 * the gateway holds it. A payment whose charge never reached the buyer (the
 * gateway failed to answer while charging) is failed, so the buyer pays
 * again: one the gateway does not know after 30 minutes, and one it holds
 * as pending, whose code the buyer never got.
 *
 * ponytail: a pass reads every active store, like OrderExpiry; one query
 * across stores when there are many.
 */
@Injectable()
export class PaymentReconciliation
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private running?: Promise<void>;
	private stopped = false;

	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly tenantDb: TenantDatabase,
		private readonly accounts: PaymentAccounts,
		@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
	) {}

	onApplicationBootstrap() {
		this.running = this.loop();
	}

	async onApplicationShutdown() {
		this.stopped = true;
		await this.running;
	}

	/** One pass over every active store. A store or payment that fails is logged and skipped. */
	async reconcile(now = new Date()): Promise<void> {
		const stores = await this.db
			.select({ id: tenants.id, slug: tenants.slug })
			.from(tenants)
			.where(eq(tenants.status, "active"));
		for (const store of stores) {
			try {
				await TenantContext.run(store, () => this.reconcileStore(now));
			} catch (error) {
				logger.error(
					`Reconciliation failed for ${store.slug}: ${(error as Error).message}`,
				);
			}
		}
	}

	private async reconcileStore(now: Date) {
		const { credential, pending } = await this.tenantDb.run(async (tx) => ({
			credential: await this.accounts.credential(tx),
			pending: await tx
				.select({
					id: payments.id,
					gatewayId: payments.gatewayId,
					createdAt: payments.createdAt,
				})
				.from(payments)
				.where(
					and(
						eq(payments.status, "pending"),
						lt(
							payments.createdAt,
							new Date(now.getTime() - CHECK_AFTER),
						),
					),
				),
		}));
		if (!credential) {
			return;
		}
		// The gateway is called outside any transaction; each payment settles in its own.
		for (const payment of pending) {
			try {
				const charge = await this.gateway.find(
					credential,
					payment.gatewayId
						? { id: payment.gatewayId }
						: { reference: payment.id },
				);
				await this.tenantDb.run(async (tx) => {
					if (
						charge &&
						(payment.gatewayId || charge.status !== "pending")
					) {
						await settlePayment(tx, payment.id, charge);
					} else if (charge) {
						await failPayment(
							tx,
							payment.id,
							"The charge did not reach the buyer; pay again",
						);
					} else if (
						payment.createdAt.getTime() <
						now.getTime() - GIVE_UP_AFTER
					) {
						await failPayment(
							tx,
							payment.id,
							"The payment gateway never got the charge; pay again",
						);
					}
				});
			} catch (error) {
				logger.error(
					`Checking payment ${payment.id} failed: ${(error as Error).message}`,
				);
			}
		}
	}

	private async loop() {
		while (!this.stopped) {
			try {
				await this.reconcile();
			} catch (error) {
				logger.error(
					`Reconciliation failed: ${(error as Error).message}`,
				);
			}
			// Short naps, so shutdown does not wait a whole pass.
			for (let i = 0; i < EVERY / 1000 && !this.stopped; i++) {
				await sleep(1_000);
			}
		}
	}
}
