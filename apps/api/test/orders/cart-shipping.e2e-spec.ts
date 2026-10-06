import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import { MELHOR_ENVIO_API } from "../../src/shipping/adapters/melhor-envio.js";
import {
	type CartClient,
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	placeOrder,
	sellableVariant,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
	testAddress,
} from "../fixtures.js";

interface Option {
	id: string;
	name: string;
	kind: string;
	price: number;
	deliveryDays: number | null;
}

interface Cart {
	state: string;
	subtotal: number;
	shipping: number;
	total: number;
	shippingMethod: {
		id: string;
		name: string;
		deliveryDays: number | null;
	} | null;
}

/** What the fake Melhor Envio got: the body of each quote request. */
interface QuoteRequest {
	to: { postal_code: string };
	products: { id: string; quantity: number; weight: number }[];
}

// Runs against the real PostgreSQL and Valkey in .env.test, with a fake Melhor
// Envio: nothing leaves the machine.
describe("Shipping in the cart (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;
	let cart: CartClient;
	let methods: Record<"fixed" | "sedex" | "pickup" | "disabled", string>;

	const requests: QuoteRequest[] = [];
	/** Sedex (service 2) for R$ 23,70 in 4 days. */
	const sedexAnswer = () =>
		new Response(
			JSON.stringify({
				id: 2,
				name: "SEDEX",
				custom_price: "23.70",
				custom_delivery_time: 4,
			}),
		);
	/** What the fake Melhor Envio answers next. */
	let carrierAnswer = sedexAnswer;

	const method = async (body: Record<string, unknown>) => {
		const response = await panel.post("/admin/shipping-methods", body);
		expect(response.statusCode).toBe(201);
		return response.json<{ id: string }>().id;
	};
	/** A variant with weight and dimensions unless `sized` is false. */
	const variant = async ({ price = 5000, sized = true } = {}) => {
		const { variantId } = await sellableVariant(panel, { price });
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
	/** A cart with the variant; with the test address unless `address` is false. */
	const cartWith = async (
		variantId: string,
		{ quantity = 1, address = true } = {},
	) => {
		const token = (await cart("POST", "/store/cart")).json<{
			token: string;
		}>().token;
		await cart("POST", "/store/cart/lines", {
			token,
			payload: { variantId, quantity },
		});
		if (address) {
			await cart("PUT", "/store/cart/shipping-address", {
				token,
				payload: testAddress,
			});
		}
		return token;
	};
	const options = (token: string, query = "") =>
		cart("GET", `/store/cart/shipping-options${query}`, { token });
	const place = (token: string, expectedTotal: number) =>
		cart("POST", "/store/cart/place", {
			token,
			payload: { expectedTotal },
		});
	const choose = (token: string, methodId: string) =>
		cart("PUT", "/store/cart/shipping-method", {
			token,
			payload: { methodId },
		});

	beforeAll(async () => {
		app = await startApp((builder) =>
			builder.overrideProvider(MELHOR_ENVIO_API).useValue({
				url: "https://melhorenvio.test",
				token: "test-token",
				userAgent: "Feitio tests (test@example.com)",
				fetch: async (_url: string, init: RequestInit) => {
					requests.push(JSON.parse(String(init.body)));
					return carrierAnswer();
				},
			}),
		);
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		owner = await fixtures.user();
		await fixtures.member(store, owner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, store);
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
			disabled: await method({
				name: "Desativado",
				kind: "fixed",
				config: { price: 1 },
				enabled: false,
			}),
		};
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(owner.id);
		await fixtures.close();
		await app.close();
	});

	describe("GET /store/cart/shipping-options", () => {
		it("quotes the enabled methods for a CEP, cheapest first", async () => {
			const variantId = await variant();
			const token = await cartWith(variantId, {
				quantity: 2,
				address: false,
			});
			requests.length = 0;

			const response = await options(token, "?cep=20040-020");

			expect(response.statusCode).toBe(200);
			expect(response.json<Option[]>()).toEqual([
				{
					id: methods.pickup,
					name: "Retirada na loja",
					kind: "pickup",
					price: 0,
					deliveryDays: null,
				},
				{
					id: methods.fixed,
					name: "Econômico",
					kind: "fixed",
					price: 1500,
					deliveryDays: 7,
				},
				{
					id: methods.sedex,
					name: "Sedex",
					kind: "melhor_envio",
					price: 2370,
					deliveryDays: 4,
				},
			]);
			expect(requests).toEqual([
				expect.objectContaining({
					to: { postal_code: "20040020" },
					products: [
						expect.objectContaining({
							id: variantId,
							quantity: 2,
							weight: 0.3,
						}),
					],
				}),
			]);
		});

		it("quotes to the shipping address when no CEP is sent, and leaves carriers out without either", async () => {
			const variantId = await variant();
			const withAddress = await cartWith(variantId);
			requests.length = 0;
			expect(
				(await options(withAddress)).json<Option[]>().map((o) => o.id),
			).toContain(methods.sedex);
			expect(requests[0].to).toEqual({ postal_code: "01310100" });

			const withoutAddress = await cartWith(variantId, {
				address: false,
			});
			expect(
				(await options(withoutAddress))
					.json<Option[]>()
					.map((o) => o.id),
			).toEqual([methods.pickup, methods.fixed]);
		});

		it("leaves a carrier out when an item has no weight or dimensions", async () => {
			const token = await cartWith(await variant({ sized: false }));
			expect(
				(await options(token)).json<Option[]>().map((o) => o.id),
			).toEqual([methods.pickup, methods.fixed]);
		});

		it("leaves out a carrier that fails, and still shows the others", async () => {
			const token = await cartWith(await variant());
			carrierAnswer = () => new Response("{}", { status: 500 });
			try {
				expect(
					(await options(token)).json<Option[]>().map((o) => o.id),
				).toEqual([methods.pickup, methods.fixed]);
			} finally {
				carrierAnswer = sedexAnswer;
			}
		});

		it("ships for free from the method's threshold on", async () => {
			const token = await cartWith(await variant({ price: 20000 }));
			expect(
				(await options(token))
					.json<Option[]>()
					.find((o) => o.id === methods.fixed)?.price,
			).toBe(0);
		});

		it("answers 400 to an invalid CEP and 404 without a cart", async () => {
			const token = await cartWith(await variant());
			expect((await options(token, "?cep=123")).statusCode).toBe(400);
			expect((await options("unknown")).statusCode).toBe(404);
		});
	});

	describe("PUT /store/cart/shipping-method", () => {
		it("prices the chosen method into the cart", async () => {
			const token = await cartWith(await variant({ price: 5000 }));

			const response = await choose(token, methods.sedex);

			expect(response.statusCode).toBe(200);
			expect(response.json<Cart>()).toMatchObject({
				subtotal: 5000,
				shipping: 2370,
				total: 7370,
				shippingMethod: {
					id: methods.sedex,
					name: "Sedex",
					deliveryDays: 4,
				},
			});
			expect(
				(await cart("GET", "/store/cart", { token })).json<Cart>(),
			).toEqual(response.json());
		});

		it("answers 400 to a method the store does not offer", async () => {
			const token = await cartWith(await variant());
			for (const methodId of [
				methods.disabled,
				"0199d5a4-0000-7000-8000-000000000000",
				"not-an-id",
			]) {
				expect((await choose(token, methodId)).statusCode).toBe(400);
			}
		});

		it("answers 409 when the method cannot ship the cart, and 502 when the carrier fails", async () => {
			const withoutAddress = await cartWith(await variant(), {
				address: false,
			});
			expect(
				(await choose(withoutAddress, methods.sedex)).statusCode,
			).toBe(409);
			const token = await cartWith(await variant());
			carrierAnswer = () => new Response("{}", { status: 503 });
			try {
				expect((await choose(token, methods.sedex)).statusCode).toBe(
					502,
				);
			} finally {
				carrierAnswer = sedexAnswer;
			}
			expect(
				(await cart("GET", "/store/cart", { token })).json<Cart>()
					.shippingMethod,
			).toBeNull();
		});

		it("is cleared when the lines or the CEP change, and kept for another address with the same CEP", async () => {
			const variantId = await variant();
			const token = await cartWith(variantId);
			await choose(token, methods.fixed);

			const sameCep = await cart("PUT", "/store/cart/shipping-address", {
				token,
				payload: { ...testAddress, number: "2000" },
			});
			expect(sameCep.json<Cart>()).toMatchObject({
				shippingMethod: { id: methods.fixed },
				shipping: 1500,
			});

			const otherCep = await cart("PUT", "/store/cart/shipping-address", {
				token,
				payload: { ...testAddress, cep: "20040-020" },
			});
			expect(otherCep.json<Cart>()).toMatchObject({
				shippingMethod: null,
				shipping: 0,
				total: 5000,
			});

			await choose(token, methods.fixed);
			const added = await cart("POST", "/store/cart/lines", {
				token,
				payload: { variantId, quantity: 1 },
			});
			expect(added.json<Cart>()).toMatchObject({
				shippingMethod: null,
				shipping: 0,
				subtotal: 10000,
				total: 10000,
			});
		});
	});

	describe("POST /store/cart/place", () => {
		const buyer = (token: string) =>
			cart("PUT", "/store/cart/customer", {
				token,
				payload: { email: "ana@example.com", name: "Ana" },
			});

		it("answers 409 without a shipping method", async () => {
			const token = await cartWith(await variant());
			await buyer(token);

			const response = await placeOrder(cart, token);

			expect(response.statusCode).toBe(409);
			expect(response.json<{ message: string }>().message).toContain(
				"shipping_method",
			);
		});

		it("places an order picked up at the store without a shipping address", async () => {
			const token = await cartWith(await variant(), { address: false });
			await buyer(token);
			await choose(token, methods.pickup);
			expect(
				(await cart("GET", "/store/cart", { token })).json<{
					missing: string[];
				}>().missing,
			).toEqual([]);

			const response = await placeOrder(cart, token);

			expect(response.statusCode).toBe(200);
			expect(response.json<Cart>()).toMatchObject({
				state: "awaiting_payment",
				shipping: 0,
				shippingMethod: { id: methods.pickup },
			});
		});

		it("quotes the chosen method again, and answers 409 with the new price saved when it changed", async () => {
			const token = await cartWith(await variant({ price: 5000 }));
			await buyer(token);
			const seen = (await choose(token, methods.sedex)).json<Cart>()
				.total;
			carrierAnswer = () =>
				new Response(
					JSON.stringify({
						id: 2,
						custom_price: "30.00",
						custom_delivery_time: 5,
					}),
				);
			try {
				const changed = await place(token, seen);

				expect(changed.statusCode).toBe(409);
				expect(
					(await cart("GET", "/store/cart", { token })).json<Cart>(),
				).toMatchObject({
					state: "cart",
					shipping: 3000,
					total: 8000,
					shippingMethod: { id: methods.sedex, deliveryDays: 5 },
				});

				const response = await place(token, 8000);

				expect(response.statusCode).toBe(200);
				expect(response.json<Cart>()).toMatchObject({
					state: "awaiting_payment",
					subtotal: 5000,
					shipping: 3000,
					total: 8000,
				});
			} finally {
				carrierAnswer = sedexAnswer;
			}
		});

		it("prices shipping for the cart as it is placed, with the catalog's prices then", async () => {
			const variantId = await variant({ price: 19000 });
			const token = await cartWith(variantId);
			await buyer(token);
			const seen = (await choose(token, methods.fixed)).json<Cart>();
			expect(seen.shipping).toBe(1500);
			await panel.patch(`/admin/variants/${variantId}`, { price: 21000 });

			expect((await place(token, seen.total)).statusCode).toBe(409);
			expect(
				(await cart("GET", "/store/cart", { token })).json<Cart>(),
			).toMatchObject({
				state: "cart",
				subtotal: 21000,
				shipping: 0,
				total: 21000,
			});
			expect((await place(token, 21000)).json<Cart>()).toMatchObject({
				state: "awaiting_payment",
				total: 21000,
			});
		});

		it("answers 409 and drops the method when the store no longer offers it", async () => {
			const disabled = await method({
				name: `Some ${crypto.randomUUID().slice(0, 8)}`,
				kind: "fixed",
				config: { price: 900 },
			});
			const token = await cartWith(await variant());
			await buyer(token);
			await choose(token, disabled);
			await panel.patch(`/admin/shipping-methods/${disabled}`, {
				enabled: false,
			});

			const response = await placeOrder(cart, token);

			expect(response.statusCode).toBe(409);
			expect(
				(await cart("GET", "/store/cart", { token })).json<Cart>(),
			).toMatchObject({
				state: "cart",
				shippingMethod: null,
				shipping: 0,
			});
		});

		it("answers 502 and stays a cart when the carrier fails", async () => {
			const token = await cartWith(await variant());
			await buyer(token);
			await choose(token, methods.sedex);
			carrierAnswer = () => new Response("{}", { status: 503 });
			try {
				const response = await placeOrder(cart, token);
				expect(response.statusCode).toBe(502);
			} finally {
				carrierAnswer = sedexAnswer;
			}
			expect(
				(await cart("GET", "/store/cart", { token })).json<Cart>(),
			).toMatchObject({
				state: "cart",
				shippingMethod: { id: methods.sedex },
			});
		});

		it("still needs a shipping address for a method that delivers", async () => {
			const token = await cartWith(await variant(), { address: false });
			await buyer(token);
			await choose(token, methods.fixed);

			const response = await placeOrder(cart, token);

			expect(response.statusCode).toBe(409);
			expect(response.json<{ message: string }>().message).toContain(
				"shipping_address",
			);
		});
	});
});
