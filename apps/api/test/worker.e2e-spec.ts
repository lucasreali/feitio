import type { TestingModule } from "@nestjs/testing";
import { Queue } from "bullmq";
import { ProductId } from "../src/domain/ids.js";
import type { DomainEvent } from "../src/events/domain-event.js";
import type { EventHandler } from "../src/events/event-handler.js";
import { publishEvent } from "../src/events/publish-event.js";
import { EVENTS_QUEUE, QUEUE_OPTIONS } from "../src/events/queue.js";
import { TenantContext } from "../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../src/tenancy/tenant-database.js";
import { Fixtures, type TestTenant, testWorker } from "./fixtures.js";

// Runs the worker module (relay and worker) against the real PostgreSQL and
// Valkey in .env.
describe("Worker (e2e)", () => {
	let worker: TestingModule;
	let fixtures: Fixtures;
	let store: TestTenant;
	const calls: { tenant: string; event: DomainEvent }[] = [];
	const failures = new Set<string>();

	const handler: EventHandler = {
		name: "test-handler",
		events: ["product.created"],
		async handle(event) {
			calls.push({ tenant: TenantContext.id(), event });
			if (
				event.type === "product.created" &&
				failures.has(event.productId)
			) {
				failures.delete(event.productId);
				throw new Error("first attempt fails");
			}
		},
	};
	const publish = (event: DomainEvent) =>
		TenantContext.run(store, () =>
			worker.get(TenantDatabase).run((tx) => publishEvent(tx, event)),
		);
	const callsFor = (productId: ProductId) =>
		calls.filter(
			({ event }) =>
				event.type === "product.created" &&
				event.productId === productId,
		);

	beforeAll(async () => {
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		worker = await testWorker([handler]);
		await worker.init();
	});

	afterAll(async () => {
		// The module closes its queue; a new one clears the test's keys.
		const queue = new Queue(EVENTS_QUEUE, worker.get(QUEUE_OPTIONS));
		await worker.close();
		await queue.obliterate({ force: true });
		await queue.close();
		await fixtures.close();
	});

	it("hands a published event to its handler, in the event's tenant", async () => {
		const productId = ProductId.generate();

		await publish({ type: "product.created", productId });

		await vi.waitFor(() => expect(callsFor(productId)).toHaveLength(1), {
			timeout: 10_000,
		});
		expect(callsFor(productId)).toEqual([
			{ tenant: store.id, event: { type: "product.created", productId } },
		]);
	}, 15_000);

	it("tries a failed job again after a wait", async () => {
		const productId = ProductId.generate();
		failures.add(productId);

		await publish({ type: "product.created", productId });

		await vi.waitFor(() => expect(callsFor(productId)).toHaveLength(2), {
			timeout: 15_000,
		});
	}, 20_000);
});
