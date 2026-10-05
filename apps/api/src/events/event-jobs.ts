import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { processedJobs } from "../database/schemas/processed-jobs.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import {
	EVENT_HANDLERS,
	type EventHandler,
	type EventJob,
} from "./event-handler.js";
import { EVENTS_QUEUE, QUEUE_OPTIONS, type QueueConnection } from "./queue.js";

const logger = new Logger("EventJobs");

/**
 * Runs the queue's event jobs (in the worker process only): each in its
 * event's tenant context, inside a tenant transaction that also records the
 * job's idempotency key, so a job delivered twice changes data once.
 */
@Injectable()
export class EventJobs
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private worker?: Worker<EventJob>;

	constructor(
		private readonly tenantDb: TenantDatabase,
		@Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
		@Inject(QUEUE_OPTIONS) private readonly options: QueueConnection,
	) {}

	onApplicationBootstrap() {
		this.worker = new Worker<EventJob>(
			EVENTS_QUEUE,
			(job) => this.process(job),
			// Each job holds a database connection while it runs.
			{ ...this.options, concurrency: 5 },
		);
		this.worker.on("failed", (job, error) => {
			if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
				logger.error(`Job ${job.id} failed for good: ${error.message}`);
			}
		});
		this.worker.on("error", (error) => logger.error(error.message));
	}

	async onApplicationShutdown() {
		// Waits for the running jobs; a job cut short runs again elsewhere.
		await this.worker?.close();
	}

	async process({
		name,
		data,
	}: Pick<Job<EventJob>, "name" | "data">): Promise<void> {
		const handler = this.handlers.find((h) => h.name === name);
		if (!handler) {
			throw new Error(`No event handler named ${name}`);
		}
		const key = `${data.eventId}.${name}`;
		await TenantContext.run(data.tenant, () =>
			this.tenantDb.run(async (tx) => {
				// Waits on a concurrent run of the same job, then finds its key.
				const [first] = await tx
					.insert(processedJobs)
					.values({ tenantId: data.tenant.id, key })
					.onConflictDoNothing()
					.returning({ key: processedJobs.key });
				if (first) {
					await handler.handle(data.event, { tx, key });
				}
			}),
		);
	}
}
