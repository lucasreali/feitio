import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ProductId } from "../../src/domain/ids.js";
import { publishEvent } from "../../src/events/publish-event.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../../src/tenancy/tenant-database.js";
import {
	Fixtures,
	startApp,
	storeEvents,
	type TestTenant,
} from "../fixtures.js";

// Runs against the real PostgreSQL in .env.test.
describe("publishEvent (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;

	const inStore = <T>(fn: (tx: TenantTransaction) => Promise<T>) =>
		TenantContext.run(store, () => app.get(TenantDatabase).run(fn));

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("keeps the event with the change that published it, pending dispatch", async () => {
		const productId = ProductId.generate();

		await inStore((tx) =>
			publishEvent(tx, { type: "product.created", productId }),
		);

		expect(await storeEvents(app, store)).toEqual([
			{
				type: "product.created",
				payload: { productId },
				dispatchedAt: null,
			},
		]);
	});

	it("drops the event when the change rolls back", async () => {
		const before = await storeEvents(app, store);

		await expect(
			inStore(async (tx) => {
				await publishEvent(tx, {
					type: "product.created",
					productId: ProductId.generate(),
				});
				throw new Error("change refused");
			}),
		).rejects.toThrow("change refused");

		expect(await storeEvents(app, store)).toEqual(before);
	});
});
