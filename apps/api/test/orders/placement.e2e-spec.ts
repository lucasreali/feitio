import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	type CartClient,
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	readyCart as readyCartOf,
	sellableVariant,
	signIn,
	startApp,
	storeEvents,
	type TestTenant,
	type TestUser,
	testAddress,
} from "../fixtures.js";

interface Cart {
	state: string;
	number: number | null;
	total: number;
}

// Runs against the real PostgreSQL and Valkey in .env, on stores of its own.
// Most tests build orders through the API, a remote round trip per step.
describe("Placing orders (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;
	let cart: CartClient;

	const stockOf = async (variantId: string) =>
		(await panel.get(`/admin/variants/${variantId}/stock`)).json<{
			available: number;
			reserved: number;
		}>();

	const readyCart = (
		variantId: string,
		{ quantity = 1, client = cart } = {},
	) => readyCartOf(client, variantId, { quantity });
	const place = (token: string, client = cart) =>
		client("POST", "/store/cart/place", { token });
	const reopen = (token: string) =>
		cart("POST", "/store/cart/reopen", { token });

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		owner = await fixtures.user();
		await fixtures.member(store, owner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, store);
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(owner.id);
		await fixtures.close();
		await app.close();
	});

	describe("POST /store/cart/place", () => {
		it("awaits payment, reserves the stock and numbers the order", async () => {
			const { variantId } = await sellableVariant(panel, {
				price: 2000,
				stock: 5,
			});
			const token = await readyCart(variantId, { quantity: 2 });

			const response = await place(token);

			expect(response.statusCode).toBe(200);
			const order = response.json<Cart>();
			expect(order).toMatchObject({
				state: "awaiting_payment",
				total: 4000,
			});
			expect(order.number).toBeGreaterThan(0);
			expect(await stockOf(variantId)).toMatchObject({
				available: 3,
				reserved: 2,
			});
			expect(
				(await cart("GET", "/store/cart", { token })).json(),
			).toEqual(order);
		});

		it("numbers a store's orders one after another, also when placed at once", async () => {
			const otherStore = await fixtures.tenant();
			const otherOwner = await fixtures.user();
			await fixtures.member(otherStore, otherOwner, "owner");
			const otherPanel = panelClient(app, await signIn(app, otherOwner));
			const otherCart = cartClient(app, otherStore);
			// One variant per cart, so their stock does not serialize them.
			// Set up one at a time: the pooler takes few connections.
			const tokens: string[] = [];
			for (let i = 0; i < 3; i++) {
				const { variantId } = await sellableVariant(otherPanel);
				tokens.push(await readyCart(variantId, { client: otherCart }));
			}

			const placed = await Promise.all(
				tokens.map((token) => place(token, otherCart)),
			);

			expect(
				placed.map((response) => response.json<Cart>().number).sort(),
			).toEqual([1, 2, 3]);
			await app.get(SessionService).destroyAllForUser(otherOwner.id);
		});

		it.each([
			["no lines", { lines: false }],
			["no customer", { customer: false }],
			["no shipping address", { address: false }],
		] as [string, { lines?: false; customer?: false; address?: false }][])(
			"answers 409 to a cart with %s",
			async (_case, missing) => {
				const { variantId } = await sellableVariant(panel);
				const token = (await cart("POST", "/store/cart")).json<{
					token: string;
				}>().token;
				if (missing.lines !== false) {
					await cart("POST", "/store/cart/lines", {
						token,
						payload: { variantId, quantity: 1 },
					});
				}
				if (missing.customer !== false) {
					await cart("PUT", "/store/cart/customer", {
						token,
						payload: { email: "ana@example.com", name: "Ana" },
					});
				}
				if (missing.address !== false) {
					await cart("PUT", "/store/cart/shipping-address", {
						token,
						payload: testAddress,
					});
				}

				expect((await place(token)).statusCode).toBe(409);
				expect(
					(await cart("GET", "/store/cart", { token })).json<Cart>(),
				).toMatchObject({ state: "cart", number: null });
			},
		);

		it("answers 409 when the stock ran out after the item was added, and reserves nothing", async () => {
			const { variantId } = await sellableVariant(panel, { stock: 2 });
			const token = await readyCart(variantId, { quantity: 2 });
			await panel.post(`/admin/variants/${variantId}/stock/adjustments`, {
				quantity: -1,
			});

			expect((await place(token)).statusCode).toBe(409);
			expect(await stockOf(variantId)).toMatchObject({
				available: 1,
				reserved: 0,
			});
		});

		it("refuses to change the order once placed", async () => {
			const { variantId } = await sellableVariant(panel);
			const token = await readyCart(variantId);
			await place(token);

			for (const [method, url, payload] of [
				["POST", "/store/cart/lines", { variantId, quantity: 1 }],
				["PUT", "/store/cart/shipping-address", testAddress],
				[
					"PUT",
					"/store/cart/customer",
					{ email: "bia@example.com", name: "Bia" },
				],
				["POST", "/store/cart/place", undefined],
			] as const) {
				expect(
					(await cart(method, url, { token, payload })).statusCode,
				).toBe(409);
			}
		});

		it("publishes the transition for the worker", async () => {
			const { variantId } = await sellableVariant(panel);
			const token = await readyCart(variantId);

			await place(token);

			const events = await storeEvents(app, store);
			expect(events.at(-1)).toMatchObject({
				type: "order.transitioned",
				payload: { from: "cart", to: "awaiting_payment" },
			});
		});
	});

	describe("POST /store/cart/reopen", () => {
		it("goes back to the cart, releasing the stock and keeping the number", async () => {
			const { variantId } = await sellableVariant(panel, { stock: 5 });
			const token = await readyCart(variantId, { quantity: 2 });
			const { number } = (await place(token)).json<Cart>();

			const response = await reopen(token);

			expect(response.statusCode).toBe(200);
			expect(response.json<Cart>()).toMatchObject({
				state: "cart",
				number,
			});
			expect(await stockOf(variantId)).toMatchObject({
				available: 5,
				reserved: 0,
			});
			expect((await place(token)).json<Cart>()).toMatchObject({
				state: "awaiting_payment",
				number,
			});
		});

		it("answers 409 to a cart", async () => {
			const { variantId } = await sellableVariant(panel);
			expect((await reopen(await readyCart(variantId))).statusCode).toBe(
				409,
			);
		});

		it("answers 404 without a cart", async () => {
			expect((await reopen("x".repeat(43))).statusCode).toBe(404);
		});
	});
});
