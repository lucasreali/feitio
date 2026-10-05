import type { DefaultJobOptions, QueueOptions } from "bullmq";
import { requireEnv } from "../config/env.js";

/** The BullMQ queue of event jobs: one job per event and handler. */
export const EVENTS_QUEUE = "events";

/** Injection token for the connection (and key prefix) of the queue and its worker. */
export const QUEUE_OPTIONS = Symbol("QUEUE_OPTIONS");

export type QueueConnection = Pick<QueueOptions, "connection" | "prefix">;

/**
 * BullMQ opens its own connections from these options; they must retry
 * forever (`maxRetriesPerRequest: null`), so never pass the shared `Valkey`.
 */
export const queueConnection = (): QueueConnection => ({
	connection: { url: requireEnv("VALKEY_URL"), maxRetriesPerRequest: null },
});

/**
 * Every job gets 8 attempts with exponential waits from 2 s (about 4 minutes
 * in all). A job that fails them all stays in the queue's failed set for 30
 * days, to be inspected and retried; completed jobs go after a day.
 */
export const jobOptions: DefaultJobOptions = {
	attempts: 8,
	backoff: { type: "exponential", delay: 2_000 },
	removeOnComplete: { age: 24 * 60 * 60 },
	removeOnFail: { age: 30 * 24 * 60 * 60 },
};
