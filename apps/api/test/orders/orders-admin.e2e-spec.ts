import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	type CartClient,
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	readyCart,
	sellableVariant,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface OrderSummary {
	id: string;
	number: number | null;
	state: string;
	customer: { id: string; name: string; email: string } | null;
	total: number;
}

interface Order extends OrderSummary {
	lines: { sku: string; quantity: number; unitPrice: number }[];
	shippingAddress: { cep: string } | null;
}

interface HistoryEntry {
	kind: string;
	data: Record<string, unknown>;
	user: { id: string; name: string } | null;
}

// Runs against the real PostgreSQL and Valkey in .env, on stores of its own.
// Most tests build orders through the API, a remote round trip per step.
describe("Order panel routes (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;
	let cart: CartClient;

	const stockOf = async (variantId: string) =>
		(await panel.get(`/admin/variants/${variantId}/stock`)).json<{
			available: number;
			reserved: number;
		}>();

	/** An order awaiting payment; answers its panel id and variant. */
	const placedOrder = async ({
		quantity = 1,
		email = `${crypto.randomUUID()}@example.com`,
		price = 2500,
	} = {}) => {
		const { variantId, sku } = await sellableVariant(panel, {
			price,
			stock: 10,
		});
		const token = await readyCart(cart, variantId, { quantity, email });
		const { number } = (
			await cart("POST", "/store/cart/place", { token })
		).json<{ number: number }>();
		const listed = await panel.get(`/admin/orders?q=${number}`);
		const [{ id }] = listed.json<{ items: OrderSummary[] }>().items;
		return { id, number, variantId, sku, email, token };
	};
	const transition = (id: string, state: string, client = panel) =>
		client.post(`/admin/orders/${id}/transitions`, { state });

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		await fixtures.shippingMethod(store);
		[staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
		panel = panelClient(app, await signIn(app, staff));
		otherPanel = panelClient(app, await signIn(app, otherOwner));
		cart = cartClient(app, store);
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	describe("GET /admin/orders", () => {
		it("lists placed orders newest first, without carts", async () => {
			const first = await placedOrder();
			const second = await placedOrder();
			await cart("POST", "/store/cart");

			const response = await panel.get("/admin/orders");

			expect(response.statusCode).toBe(200);
			const page = response.json<{
				items: OrderSummary[];
				total: number;
			}>();
			expect(page.items.map((order) => order.number)).toEqual(
				expect.arrayContaining([second.number, first.number]),
			);
			expect(
				page.items.findIndex((o) => o.id === second.id),
			).toBeLessThan(page.items.findIndex((o) => o.id === first.id));
			expect(page.items.every((order) => order.state !== "cart")).toBe(
				true,
			);
			expect(page.items[0]).toMatchObject({
				id: second.id,
				state: "awaiting_payment",
				customer: { email: second.email, name: "Ana Souza" },
				total: 4000,
			});
		});

		it("filters by state, customer, number and e-mail", async () => {
			const paid = await placedOrder();
			await transition(paid.id, "paid");
			const other = await placedOrder();
			const { customer } = (
				await panel.get(`/admin/orders/${other.id}`)
			).json<Order>();

			const ids = async (query: string) =>
				(await panel.get(`/admin/orders?${query}`))
					.json<{ items: OrderSummary[] }>()
					.items.map((order) => order.id);

			expect(await ids("state=paid")).toContain(paid.id);
			expect(await ids("state=paid")).not.toContain(other.id);
			expect(await ids(`customerId=${customer?.id}`)).toEqual([other.id]);
			expect(await ids(`q=${other.number}`)).toEqual([other.id]);
			expect(await ids(`q=${other.email.slice(0, 12)}`)).toEqual([
				other.id,
			]);
			expect(await ids("state=cart")).not.toContain(other.id);
		});

		it.each(["state=unknown", "customerId=x", "page=0"])(
			"answers 400 to %s",
			async (query) => {
				expect(
					(await panel.get(`/admin/orders?${query}`)).statusCode,
				).toBe(400);
			},
		);

		it("shows only the store's orders", async () => {
			const order = await placedOrder();

			const page = (await otherPanel.get("/admin/orders")).json<{
				items: OrderSummary[];
			}>();

			expect(page.items.map((o) => o.id)).not.toContain(order.id);
			expect(
				(await otherPanel.get(`/admin/orders/${order.id}`)).statusCode,
			).toBe(404);
			expect(
				(await transition(order.id, "paid", otherPanel)).statusCode,
			).toBe(404);
		});
	});

	describe("GET /admin/orders/:id", () => {
		it("shows the order with its buyer, address and lines", async () => {
			const order = await placedOrder({ quantity: 3, price: 1000 });

			const response = await panel.get(`/admin/orders/${order.id}`);

			expect(response.statusCode).toBe(200);
			expect(response.json<Order>()).toMatchObject({
				id: order.id,
				number: order.number,
				state: "awaiting_payment",
				customer: { email: order.email, name: "Ana Souza" },
				shippingAddress: { cep: "01310100" },
				lines: [{ sku: order.sku, quantity: 3, unitPrice: 1000 }],
				subtotal: 3000,
				shipping: 1500,
				total: 4500,
				shippingMethod: { name: "Frete fixo" },
				trackingCode: null,
				labelUrl: null,
			});
		});

		it.each(["not-an-id", "0199d5a4-0000-7000-8000-000000000000"])(
			"answers 404 to %s",
			async (id) => {
				expect(
					(await panel.get(`/admin/orders/${id}`)).statusCode,
				).toBe(404);
			},
		);
	});

	describe("POST /admin/orders/:id/transitions", () => {
		it("takes an order from payment to delivery, selling its stock", async () => {
			const order = await placedOrder({ quantity: 2 });

			for (const state of ["paid", "preparing", "shipped", "delivered"]) {
				const response = await transition(order.id, state);
				expect(response.statusCode, state).toBe(200);
				expect(response.json<Order>().state).toBe(state);
			}
			expect(await stockOf(order.variantId)).toMatchObject({
				available: 8,
				reserved: 0,
			});
		});

		it("cancels an unpaid order, releasing its stock", async () => {
			const order = await placedOrder({ quantity: 2 });

			expect((await transition(order.id, "cancelled")).statusCode).toBe(
				200,
			);
			expect(await stockOf(order.variantId)).toMatchObject({
				available: 10,
				reserved: 0,
			});
		});

		it("cancels a paid order, taking its units back", async () => {
			const order = await placedOrder({ quantity: 2 });
			await transition(order.id, "paid");

			expect((await transition(order.id, "cancelled")).statusCode).toBe(
				200,
			);
			expect(await stockOf(order.variantId)).toMatchObject({
				available: 10,
				reserved: 0,
			});
		});

		it.each([
			["awaiting_payment", "shipped", []],
			[
				"delivered",
				"cancelled",
				["paid", "preparing", "shipped", "delivered"],
			],
			// Only the buyer takes an order back to the cart.
			["awaiting_payment", "cart", []],
		])("answers 409 from %s to %s", async (_from, to, before) => {
			const order = await placedOrder();
			for (const state of before) {
				await transition(order.id, state);
			}

			expect((await transition(order.id, to)).statusCode).toBe(409);
		});

		it("never moves a cart", async () => {
			await cart("POST", "/store/cart");
			const carts = (await panel.get("/admin/orders?state=cart")).json<{
				items: OrderSummary[];
			}>().items;

			expect((await transition(carts[0].id, "paid")).statusCode).toBe(
				409,
			);
		});

		it.each([{}, { state: "unknown" }, { state: "paid", other: 1 }])(
			"answers 400 to %j",
			async (body) => {
				const order = await placedOrder();
				expect(
					(
						await panel.post(
							`/admin/orders/${order.id}/transitions`,
							body,
						)
					).statusCode,
				).toBe(400);
			},
		);
	});

	describe("PUT /admin/orders/:id/shipment", () => {
		const shipment = {
			trackingCode: "AA123456789BR",
			labelUrl: "https://labels.example.com/aa123.pdf",
		};

		it("records the tracking code and label of a paid order; the buyer sees the code", async () => {
			const order = await placedOrder();
			await transition(order.id, "paid");

			const response = await panel.put(
				`/admin/orders/${order.id}/shipment`,
				shipment,
			);

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject(shipment);
			const seen = (
				await cart("GET", "/store/cart", { token: order.token })
			).json<Record<string, unknown>>();
			expect(seen.trackingCode).toBe(shipment.trackingCode);
			expect(seen).not.toHaveProperty("labelUrl");
			const cleared = await panel.put(
				`/admin/orders/${order.id}/shipment`,
				{
					trackingCode: null,
					labelUrl: null,
				},
			);
			expect(cleared.json()).toMatchObject({
				trackingCode: null,
				labelUrl: null,
			});
		});

		it("answers 409 before payment, and 400 to an invalid label or partial body", async () => {
			const order = await placedOrder();
			expect(
				(
					await panel.put(
						`/admin/orders/${order.id}/shipment`,
						shipment,
					)
				).statusCode,
			).toBe(409);
			await transition(order.id, "paid");
			for (const body of [
				{ ...shipment, labelUrl: "http://labels.example.com/a.pdf" },
				{ trackingCode: "AA123456789BR" },
			]) {
				expect(
					(
						await panel.put(
							`/admin/orders/${order.id}/shipment`,
							body,
						)
					).statusCode,
				).toBe(400);
			}
		});

		it("answers 404 to another store's order", async () => {
			const order = await placedOrder();
			expect(
				(
					await otherPanel.put(
						`/admin/orders/${order.id}/shipment`,
						shipment,
					)
				).statusCode,
			).toBe(404);
		});
	});

	describe("history and notes", () => {
		it("records who moved the order and the staff's notes, newest first", async () => {
			const order = await placedOrder();
			await transition(order.id, "paid");

			const note = await panel.post(`/admin/orders/${order.id}/notes`, {
				note: "  Embrulhar para presente  ",
			});
			expect(note.statusCode).toBe(201);

			const response = await panel.get(
				`/admin/orders/${order.id}/history`,
			);
			expect(response.statusCode).toBe(200);
			const entries = response.json<{ items: HistoryEntry[] }>().items;
			expect(entries).toMatchObject([
				{
					kind: "note",
					data: { note: "Embrulhar para presente" },
					user: { id: staff.id, name: staff.name },
				},
				{
					kind: "transition",
					data: { from: "awaiting_payment", to: "paid" },
					user: { id: staff.id },
				},
				{
					kind: "transition",
					data: { from: "cart", to: "awaiting_payment" },
					user: null,
				},
			]);
		});

		it("keeps notes out of the store's view", async () => {
			const order = await placedOrder();
			await panel.post(`/admin/orders/${order.id}/notes`, {
				note: "Cliente difícil",
			});

			const seen = await cart("GET", "/store/cart", {
				token: order.token,
			});

			expect(seen.body).not.toContain("difícil");
		});

		it.each([{}, { note: " " }, { note: "x".repeat(2001) }])(
			"answers 400 to the note %j",
			async (body) => {
				const order = await placedOrder();
				expect(
					(await panel.post(`/admin/orders/${order.id}/notes`, body))
						.statusCode,
				).toBe(400);
			},
		);

		it("answers 404 for another store's order", async () => {
			const order = await placedOrder();
			expect(
				(await otherPanel.get(`/admin/orders/${order.id}/history`))
					.statusCode,
			).toBe(404);
			expect(
				(
					await otherPanel.post(`/admin/orders/${order.id}/notes`, {
						note: "x",
					})
				).statusCode,
			).toBe(404);
		});
	});
});
