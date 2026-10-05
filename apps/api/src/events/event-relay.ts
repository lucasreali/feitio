import { setTimeout as sleep } from "node:timers/promises";
import {
	Inject,
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { domainEvents } from "../database/schemas/domain-events.js";
import { tenants } from "../database/schemas/tenants.js";
import type { DomainEvent } from "./domain-event.js";
import {
	EVENT_HANDLERS,
	type EventHandler,
	type EventJob,
} from "./event-handler.js";

const logger = new Logger("EventRelay");

/** Events moved per transaction. */
const BATCH = 100;

/**
 * Moves pending events from the outbox (`domain_events`) to the queue, as
 * one job per event and handler that takes it (in the worker process only).
 * Job ids are event id plus handler name, so an event relayed twice (jobs
 * queued, then the commit failed) still makes one job each. Concurrent
 * relays skip each other's locked rows.
 *
 * ponytail: polls every second while idle; LISTEN/NOTIFY if that delay or
 * the idle queries ever matter.
 */
@Injectable()
export class EventRelay
	implements OnApplicationBootstrap, OnApplicationShutdown
{
	private running?: Promise<void>;
	private stopped = false;

	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly queue: Queue<EventJob>,
		@Inject(EVENT_HANDLERS) private readonly handlers: EventHandler[],
	) {}

	onApplicationBootstrap() {
		this.running = this.loop();
	}

	async onApplicationShutdown() {
		this.stopped = true;
		await this.running;
	}

	/** Relays up to `BATCH` pending events, oldest first; returns how many. */
	relay(): Promise<number> {
		return this.db.transaction(async (tx) => {
			// Every store's events: the relay is the one reader across tenants.
			await tx.execute(
				sql`select set_config('app.event_relay', 'on', true)`,
			);
			const pending = await tx
				.select({
					id: domainEvents.id,
					type: domainEvents.type,
					payload: domainEvents.payload,
					tenantId: tenants.id,
					slug: tenants.slug,
				})
				.from(domainEvents)
				.innerJoin(tenants, eq(tenants.id, domainEvents.tenantId))
				.where(isNull(domainEvents.dispatchedAt))
				.orderBy(asc(domainEvents.id))
				.limit(BATCH)
				.for("update", { of: domainEvents, skipLocked: true });
			if (pending.length === 0) {
				return 0;
			}
			await this.queue.addBulk(
				pending.flatMap(({ id, type, payload, tenantId, slug }) => {
					// Written only by publishEvent, from a DomainEvent.
					const event = { type, ...payload } as DomainEvent;
					return this.handlers
						.filter((handler) =>
							handler.events.includes(event.type),
						)
						.map((handler) => ({
							name: handler.name,
							data: {
								eventId: id,
								tenant: { id: tenantId, slug },
								event,
							},
							opts: { jobId: `${id}.${handler.name}` },
						}));
				}),
			);
			await tx
				.update(domainEvents)
				.set({ dispatchedAt: sql`now()` })
				.where(
					inArray(
						domainEvents.id,
						pending.map((event) => event.id),
					),
				);
			return pending.length;
		});
	}

	private async loop() {
		while (!this.stopped) {
			try {
				if ((await this.relay()) === BATCH) {
					continue;
				}
			} catch (error) {
				logger.error(`Relay failed: ${(error as Error).message}`);
			}
			await sleep(1_000);
		}
	}
}
