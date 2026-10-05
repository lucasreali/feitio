import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { DatabaseModule } from "./database/database.module.js";
import { EVENT_HANDLERS } from "./events/event-handler.js";
import { EventJobs } from "./events/event-jobs.js";
import { EventRelay } from "./events/event-relay.js";
import {
	EVENTS_QUEUE,
	jobOptions,
	QUEUE_OPTIONS,
	type QueueConnection,
	queueConnection,
} from "./events/queue.js";
import { OrderExpiry } from "./orders/order-expiry.js";
import { PaymentGatewayModule } from "./payments/payment-gateway.module.js";
import { PaymentNotifications } from "./payments/payment-notifications.js";
import { PaymentReconciliation } from "./payments/payment-reconciliation.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

/**
 * The worker process (`src/worker.ts`): relays domain events to the queue,
 * runs their jobs (payments the gateway notified, among them), checks
 * pending payments with the gateway and expires unpaid orders and abandoned
 * carts, apart from the API's requests.
 */
@Module({
	imports: [DatabaseModule, PaymentGatewayModule, TenancyModule],
	providers: [
		{ provide: QUEUE_OPTIONS, useFactory: queueConnection },
		{
			provide: Queue,
			useFactory: (options: QueueConnection) =>
				new Queue(EVENTS_QUEUE, {
					...options,
					defaultJobOptions: jobOptions,
				}),
			inject: [QUEUE_OPTIONS],
		},
		// Modules add their handlers here as they arrive (notifications, search).
		{
			provide: EVENT_HANDLERS,
			useFactory: (payments: PaymentNotifications) => [payments],
			inject: [PaymentNotifications],
		},
		EventRelay,
		EventJobs,
		OrderExpiry,
		PaymentReconciliation,
	],
})
export class WorkerModule implements OnApplicationShutdown {
	constructor(private readonly queue: Queue) {}

	async onApplicationShutdown() {
		await this.queue.close();
	}
}
