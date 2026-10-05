import type { DomainEventId } from "../domain/ids.js";
import type { CurrentTenant } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { DomainEvent, DomainEventType } from "./domain-event.js";

/** Injection token for the worker's list of `EventHandler`s. */
export const EVENT_HANDLERS = Symbol("EVENT_HANDLERS");

/** Work the worker does for each event of the types it takes. */
export interface EventHandler {
	/**
	 * Unique and stable: it names the jobs and their idempotency keys. No ":",
	 * which BullMQ refuses in job ids.
	 */
	readonly name: string;
	readonly events: readonly DomainEventType[];
	/**
	 * Runs in the event's tenant context. Writes through `tx` commit together
	 * with the job's idempotency `key`, so they happen once even when the job
	 * runs again; calls to a vendor should send `key` as its idempotency key.
	 * Throwing fails the attempt, and the job is retried.
	 */
	handle(
		event: DomainEvent,
		job: { tx: TenantTransaction; key: string },
	): Promise<void>;
}

/** The data of a job: one event for one handler (the job's name). */
export interface EventJob {
	eventId: DomainEventId;
	tenant: CurrentTenant;
	event: DomainEvent;
}
