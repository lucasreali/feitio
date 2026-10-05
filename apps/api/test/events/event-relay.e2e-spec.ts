import { Test, type TestingModule } from "@nestjs/testing";
import { Queue } from "bullmq";
import { asc, isNull } from "drizzle-orm";
import { domainEvents } from "../../src/database/schemas/domain-events.js";
import { ProductId, ProductVariantId } from "../../src/domain/ids.js";
import type { DomainEvent } from "../../src/events/domain-event.js";
import {
	EVENT_HANDLERS,
	type EventHandler,
	type EventJob,
} from "../../src/events/event-handler.js";
import { EventRelay } from "../../src/events/event-relay.js";
import { publishEvent } from "../../src/events/publish-event.js";
import { QUEUE_OPTIONS, queueConnection } from "../../src/events/queue.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../../src/tenancy/tenant-database.js";
import { WorkerModule } from "../../src/worker.module.js";
import { Fixtures, type TestTenant } from "../fixtures.js";

/** A worker module on its own queue keys, so no other worker takes its jobs. */
const testWorker = (handlers: EventHandler[]) =>
	Test.createTestingModule({ imports: [WorkerModule] })
		.overrideProvider(QUEUE_OPTIONS)
		.useValue({
			...queueConnection(),
			prefix: `test-${crypto.randomUUID()}`,
		})
		.overrideProvider(EVENT_HANDLERS)
		.useValue(handlers)
		.compile();

const handler = (name: string, events: EventHandler["events"]) => ({
	name,
	events,
	handle: async () => {},
});

// Runs against the real PostgreSQL and Valkey in .env; the module is not
// started, so the test drives the relay.
describe("Event relay (e2e)", () => {
	let moduleRef: TestingModule;
	let fixtures: Fixtures;
	let store: TestTenant;

	const publish = (event: DomainEvent) =>
		inStore((tx) => publishEvent(tx, event));
	/** Relays until nothing is pending (other test files publish too). */
	const relayAll = async () => {
		while ((await moduleRef.get(EventRelay).relay()) > 0) {}
	};
	/** This store's waiting jobs, by job id. */
	const storeJobs = async () => {
		const jobs = await moduleRef
			.get<Queue, Queue<EventJob>>(Queue)
			.getJobs(["waiting"]);
		return jobs
			.filter((job) => job.data.tenant.id === store.id)
			.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
	};
	const inStore = <T>(fn: (tx: TenantTransaction) => Promise<T>) =>
		TenantContext.run(store, () => moduleRef.get(TenantDatabase).run(fn));
	const eventIds = () =>
		inStore((tx) =>
			tx
				.select({ id: domainEvents.id })
				.from(domainEvents)
				.orderBy(asc(domainEvents.id)),
		).then((rows) => rows.map((row) => row.id));
	const pendingIds = () =>
		inStore((tx) =>
			tx
				.select({ id: domainEvents.id })
				.from(domainEvents)
				.where(isNull(domainEvents.dispatchedAt)),
		);

	beforeAll(async () => {
		moduleRef = await testWorker([
			handler("catalog", ["product.created"]),
			handler("everything", ["product.created", "stock.changed"]),
		]);
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
	});

	afterAll(async () => {
		await moduleRef.get(Queue).obliterate({ force: true });
		await fixtures.close();
		await moduleRef.close();
	});

	it("queues each pending event once per handler that takes it, and marks it dispatched", async () => {
		const productId = ProductId.generate();
		const variantId = ProductVariantId.generate();
		await publish({ type: "product.created", productId });
		await publish({
			type: "stock.changed",
			kind: "adjustment",
			lines: [{ variantId, quantity: 3 }],
		});

		await relayAll();

		const [created, changed] = await eventIds();
		const tenant = { id: store.id, slug: store.slug };
		expect(
			(await storeJobs()).map(({ id, name, data }) => ({
				id,
				name,
				data,
			})),
		).toEqual(
			[
				{
					id: `${created}.catalog`,
					name: "catalog",
					data: {
						eventId: created,
						tenant,
						event: { type: "product.created", productId },
					},
				},
				{
					id: `${created}.everything`,
					name: "everything",
					data: {
						eventId: created,
						tenant,
						event: { type: "product.created", productId },
					},
				},
				{
					id: `${changed}.everything`,
					name: "everything",
					data: {
						eventId: changed,
						tenant,
						event: {
							type: "stock.changed",
							kind: "adjustment",
							lines: [{ variantId, quantity: 3 }],
						},
					},
				},
			].sort((a, b) => a.id.localeCompare(b.id)),
		);
		expect(await pendingIds()).toEqual([]);
	});

	it("queues a job once even when its event is relayed again", async () => {
		const before = (await storeJobs()).length;
		// As if the relay's commit had failed after the jobs were queued.
		await inStore((tx) =>
			tx.update(domainEvents).set({ dispatchedAt: null }),
		);

		await relayAll();

		expect(await storeJobs()).toHaveLength(before);
		expect(await pendingIds()).toEqual([]);
	});

	it("retries jobs with exponential backoff and keeps the ones that fail for good", async () => {
		const [job] = await storeJobs();

		expect(job.opts).toMatchObject({
			attempts: 8,
			backoff: { type: "exponential", delay: 2_000 },
			removeOnFail: { age: 30 * 24 * 60 * 60 },
		});
	});
});
