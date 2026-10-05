import { Test, type TestingModule } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { DomainEventId, ProductId } from "../../src/domain/ids.js";
import type { DomainEvent } from "../../src/events/domain-event.js";
import {
	EVENT_HANDLERS,
	type EventHandler,
	type EventJob,
} from "../../src/events/event-handler.js";
import { EventJobs } from "../../src/events/event-jobs.js";
import { QUEUE_OPTIONS } from "../../src/events/queue.js";
import { TenancyModule } from "../../src/tenancy/tenancy.module.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { Fixtures, type TestTenant } from "../fixtures.js";

/** What the handler saw on each call. */
interface Call {
	contextTenant: string;
	transactionTenant: string;
	key: string;
}

// Runs against the real PostgreSQL in .env.test; the BullMQ worker is not started.
describe("Event jobs (e2e)", () => {
	let moduleRef: TestingModule;
	let fixtures: Fixtures;
	let store: TestTenant;
	let calls: Call[];
	let failNext: boolean;

	const handler: EventHandler = {
		name: "test-handler",
		events: ["product.created"],
		async handle(_event, { tx, key }) {
			const {
				rows: [row],
			} = await tx.execute<{ tenant: string }>(
				sql`select current_setting('app.tenant_id') as tenant`,
			);
			calls.push({
				contextTenant: TenantContext.id(),
				transactionTenant: row.tenant,
				key,
			});
			if (failNext) {
				failNext = false;
				throw new Error("handler failed");
			}
		},
	};

	const job = (name = handler.name): { name: string; data: EventJob } => {
		const event: DomainEvent = {
			type: "product.created",
			productId: ProductId.generate(),
		};
		return {
			name,
			data: { eventId: DomainEventId.generate(), tenant: store, event },
		};
	};
	const run = (j: { name: string; data: EventJob }) =>
		moduleRef.get(EventJobs).process(j);

	beforeAll(async () => {
		moduleRef = await Test.createTestingModule({
			imports: [TenancyModule],
			providers: [
				EventJobs,
				{ provide: EVENT_HANDLERS, useValue: [handler] },
				{ provide: QUEUE_OPTIONS, useValue: {} },
			],
		}).compile();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
	});

	beforeEach(() => {
		calls = [];
		failNext = false;
	});

	afterAll(async () => {
		await fixtures.close();
		await moduleRef.close();
	});

	it("runs the handler in the job's tenant, in a transaction bound to it", async () => {
		const j = job();

		await run(j);

		expect(calls).toEqual([
			{
				contextTenant: store.id,
				transactionTenant: store.id,
				key: `${j.data.eventId}.${handler.name}`,
			},
		]);
	});

	it("runs a job once, however many times it is delivered", async () => {
		const j = job();

		await Promise.all([run(j), run(j)]);
		await run(j);

		expect(calls).toHaveLength(1);
	});

	it("runs a failed job again on the next attempt", async () => {
		const j = job();
		failNext = true;

		await expect(run(j)).rejects.toThrow("handler failed");
		await run(j);
		await run(j);

		expect(calls).toHaveLength(2);
	});

	it("fails a job no handler takes", async () => {
		await expect(run(job("unknown"))).rejects.toThrow(/unknown/);
	});
});
