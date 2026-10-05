import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import { MELHOR_ENVIO_API } from "../../src/shipping/adapters/melhor-envio.js";
import {
	Fixtures,
	type PanelClient,
	panelClient,
	sellableVariant,
	signIn,
	startApp,
	storeClient,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface Option {
	id: string;
	price: number;
	deliveryDays: number | null;
}

// Runs against the real PostgreSQL and Valkey in .env, with a fake Melhor
// Envio: nothing leaves the machine.
describe("Shipping simulation for a product (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;
	let get: ReturnType<typeof storeClient>;
	let methods: Record<"fixed" | "sedex" | "pickup", string>;
	/** The bodies the fake Melhor Envio got. */
	const requests: { to: unknown; products: unknown[] }[] = [];

	const method = async (body: Record<string, unknown>) => {
		const response = await panel.post("/admin/shipping-methods", body);
		expect(response.statusCode).toBe(201);
		return response.json<{ id: string }>().id;
	};
	/** A variant with weight and dimensions unless `sized` is false. */
	const variant = async ({
		price = 5000,
		sized = true,
		status = "active",
	} = {}) => {
		const { variantId } = await sellableVariant(panel, { price, status });
		if (sized) {
			await panel.patch(`/admin/variants/${variantId}`, {
				weight: 300,
				height: 5,
				width: 20,
				length: 30,
			});
		}
		return variantId;
	};
	const simulate = (query: string) => get(`/store/shipping-options?${query}`);

	beforeAll(async () => {
		app = await startApp((builder) =>
			builder.overrideProvider(MELHOR_ENVIO_API).useValue({
				url: "https://melhorenvio.test",
				token: "test-token",
				userAgent: "Feitio tests (test@example.com)",
				fetch: async (_url: string, init: RequestInit) => {
					requests.push(JSON.parse(String(init.body)));
					return new Response(
						JSON.stringify({
							id: 2,
							custom_price: "23.70",
							custom_delivery_time: 4,
						}),
					);
				},
			}),
		);
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		owner = await fixtures.user();
		await fixtures.member(store, owner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		get = storeClient(app, store);
		methods = {
			fixed: await method({
				name: "Econômico",
				kind: "fixed",
				config: { price: 1500, freeAbove: 20000, deliveryDays: 7 },
			}),
			sedex: await method({
				name: "Sedex",
				kind: "melhor_envio",
				config: { serviceId: 2, originCep: "96020360" },
			}),
			pickup: await method({ name: "Retirada na loja", kind: "pickup" }),
		};
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(owner.id);
		await fixtures.close();
		await app.close();
	});

	it("quotes units of a product to a CEP, cheapest first, without a cart", async () => {
		const variantId = await variant({ price: 5000 });
		requests.length = 0;

		const response = await simulate(
			`variantId=${variantId}&quantity=2&cep=20040-020`,
		);

		expect(response.statusCode).toBe(200);
		expect(response.json<Option[]>()).toEqual([
			expect.objectContaining({ id: methods.pickup, price: 0 }),
			expect.objectContaining({
				id: methods.fixed,
				price: 1500,
				deliveryDays: 7,
			}),
			expect.objectContaining({
				id: methods.sedex,
				price: 2370,
				deliveryDays: 4,
			}),
		]);
		expect(requests).toEqual([
			expect.objectContaining({
				to: { postal_code: "20040020" },
				products: [
					expect.objectContaining({ id: variantId, quantity: 2 }),
				],
			}),
		]);
	});

	it("prices the units together: one unit by default, free shipping from the threshold on", async () => {
		const variantId = await variant({ price: 10000 });
		const fixedPrice = async (query: string) =>
			(await simulate(`variantId=${variantId}&cep=20040020${query}`))
				.json<Option[]>()
				.find((option) => option.id === methods.fixed)?.price;

		expect(await fixedPrice("")).toBe(1500);
		expect(await fixedPrice("&quantity=2")).toBe(0);
	});

	it("leaves a carrier out for a product without weight or dimensions", async () => {
		const variantId = await variant({ sized: false });
		expect(
			(await simulate(`variantId=${variantId}&cep=20040020`))
				.json<Option[]>()
				.map((option) => option.id),
		).toEqual([methods.pickup, methods.fixed]);
	});

	it.each([
		"cep=20040020",
		"variantId=not-an-id&cep=20040020",
		"variantId=0199d5a4-0000-7000-8000-000000000000",
		"variantId=0199d5a4-0000-7000-8000-000000000000&cep=123",
		"variantId=0199d5a4-0000-7000-8000-000000000000&cep=20040020&quantity=0",
		"variantId=0199d5a4-0000-7000-8000-000000000000&cep=20040020&quantity=1000",
	])("answers 400 to %s", async (query) => {
		expect((await simulate(query)).statusCode).toBe(400);
	});

	it("answers 404 to a product the store does not sell, or of another store", async () => {
		const draft = await variant({ status: "draft" });
		expect(
			(await simulate(`variantId=${draft}&cep=20040020`)).statusCode,
		).toBe(404);
		const sold = await variant();
		expect(
			(
				await storeClient(
					app,
					otherStore,
				)(`/store/shipping-options?variantId=${sold}&cep=20040020`)
			).statusCode,
		).toBe(404);
	});
});
