import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	sellableVariant,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

const address = {
	recipient: "Ana Souza",
	cep: "01310-100",
	street: "Av. Paulista",
	number: "1000",
	neighborhood: "Bela Vista",
	city: "São Paulo",
	state: "SP",
};

// Runs against the real PostgreSQL and Valkey in .env.
// Some tests build orders through the API, a remote round trip per step.
describe("Customer data requests, LGPD (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let staffPanel: PanelClient;
	let otherPanel: PanelClient;

	const storeCall = (
		method: "GET" | "POST",
		url: string,
		options: { token?: string; payload?: unknown } = {},
	) =>
		app.inject({
			method,
			url,
			payload: options.payload as object | undefined,
			headers: {
				"x-tenant": store.slug,
				...(options.token && {
					authorization: `Bearer ${options.token}`,
				}),
			},
		});
	/** A registered buyer with an address, in a group, with a note. */
	const buyer = async () => {
		const email = `${crypto.randomUUID()}@example.com`;
		const { token, customer } = (
			await storeCall("POST", "/store/account/register", {
				payload: { email, password: "correct horse", name: "Ana" },
			})
		).json<{ token: string; customer: { id: string } }>();
		await storeCall("POST", "/store/account/addresses", {
			token,
			payload: address,
		});
		const group = (
			await panel.post("/admin/customer-groups", {
				name: `VIP ${crypto.randomUUID().slice(0, 8)}`,
			})
		).json<{ id: string; name: string }>();
		await panel.patch(`/admin/customers/${customer.id}`, {
			groupIds: [group.id],
		});
		await panel.post(`/admin/customers/${customer.id}/notes`, {
			note: "Asked for her data",
		});
		return { id: customer.id, email, token, group };
	};

	/**
	 * A cart of the signed-in buyer with an address; placed unless `place` is
	 * false. Answers the cart's token and, once placed, the panel's order id.
	 */
	const orderOf = async (buyerToken: string, { place = true } = {}) => {
		const cart = cartClient(app, store);
		const { variantId } = await sellableVariant(panel, { price: 1500 });
		const token = (await cart("POST", "/store/cart")).json<{
			token: string;
		}>().token;
		await cart("POST", "/store/cart/lines", {
			token,
			payload: { variantId, quantity: 2 },
		});
		await cart("PUT", "/store/cart/customer", {
			token,
			headers: { authorization: `Bearer ${buyerToken}` },
		});
		await cart("PUT", "/store/cart/shipping-address", {
			token,
			payload: address,
		});
		if (!place) {
			return { token, id: undefined };
		}
		const { number } = (
			await cart("POST", "/store/cart/place", { token })
		).json<{ number: number }>();
		const [{ id }] = (await panel.get(`/admin/orders?q=${number}`)).json<{
			items: { id: string }[];
		}>().items;
		return { token, id: id as string };
	};

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		[owner, staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, owner, "owner");
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		staffPanel = panelClient(app, await signIn(app, staff));
		otherPanel = panelClient(app, await signIn(app, otherOwner));
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [owner, staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	describe("GET /admin/customers/:id/export", () => {
		it("hands over everything the store keeps about the customer", async () => {
			const { id, email, group } = await buyer();

			const response = await staffPanel.get(
				`/admin/customers/${id}/export`,
			);

			expect(response.statusCode).toBe(200);
			expect(response.headers["content-disposition"]).toBe(
				`attachment; filename="customer-${id}.json"`,
			);
			const data = response.json();
			expect(data).toEqual({
				exportedAt: expect.any(String),
				customer: {
					id,
					email,
					name: "Ana",
					phone: null,
					taxId: null,
					registered: true,
					createdAt: expect.any(String),
					updatedAt: expect.any(String),
				},
				addresses: [expect.objectContaining({ cep: "01310100" })],
				groups: [{ id: group.id, name: group.name }],
				history: expect.any(Array),
				orders: [],
			});
			expect(
				data.history.map((entry: { kind: string }) => entry.kind),
			).toEqual([
				"note",
				"added_to_group",
				"address_added",
				"registered",
			]);
			expect(JSON.stringify(data)).not.toContain("scrypt");
		});

		it("hands over the customer's orders and carts", async () => {
			const { id, token } = await buyer();
			await orderOf(token);
			await orderOf(token, { place: false });

			const { orders } = (
				await panel.get(`/admin/customers/${id}/export`)
			).json<{ orders: unknown[] }>();

			expect(orders).toEqual([
				expect.objectContaining({
					state: "cart",
					number: null,
					shippingAddress: expect.objectContaining({
						cep: "01310100",
					}),
				}),
				expect.objectContaining({
					state: "awaiting_payment",
					number: expect.any(Number),
					lines: [
						expect.objectContaining({
							quantity: 2,
							unitPrice: 1500,
						}),
					],
					total: 3000,
				}),
			]);
		});

		it("answers 404 to another store's customer", async () => {
			const { id } = await buyer();
			expect(
				(await otherPanel.get(`/admin/customers/${id}/export`))
					.statusCode,
			).toBe(404);
		});
	});

	describe("DELETE /admin/customers/:id", () => {
		it("erases the customer and ends their sessions", async () => {
			const { id, email, token } = await buyer();

			expect(
				(await panel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(204);

			expect((await panel.get(`/admin/customers/${id}`)).statusCode).toBe(
				404,
			);
			expect(
				(await panel.get(`/admin/customers/${id}/history`)).statusCode,
			).toBe(404);
			expect(
				(await storeCall("GET", "/store/account", { token }))
					.statusCode,
			).toBe(401);
			const again = await storeCall("POST", "/store/account/register", {
				payload: { email, password: "correct horse", name: "Ana" },
			});
			expect(again.statusCode).toBe(201);
		});

		it("detaches the customer's past orders, clearing their addresses, and removes their carts", async () => {
			const { id, token } = await buyer();
			const delivered = await orderOf(token);
			for (const state of ["paid", "preparing", "shipped", "delivered"]) {
				await panel.post(`/admin/orders/${delivered.id}/transitions`, {
					state,
				});
			}
			const cancelled = await orderOf(token);
			await panel.post(`/admin/orders/${cancelled.id}/transitions`, {
				state: "cancelled",
			});
			const cart = await orderOf(token, { place: false });

			expect(
				(await panel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(204);

			for (const order of [delivered, cancelled]) {
				expect(
					(await panel.get(`/admin/orders/${order.id}`)).json(),
				).toMatchObject({
					customer: null,
					shippingAddress: null,
					billingAddress: null,
					lines: [{ quantity: 2 }],
					total: 3000,
				});
			}
			expect(
				(
					await cartClient(app, store)("GET", "/store/cart", {
						token: cart.token,
					})
				).statusCode,
			).toBe(404);
		});

		it.each(["awaiting_payment", "paid", "preparing", "shipped"])(
			"answers 409 while an order is %s",
			async (state) => {
				const { id, token } = await buyer();
				const order = await orderOf(token);
				for (const next of ["paid", "preparing", "shipped"]) {
					if (state === "awaiting_payment") {
						break;
					}
					await panel.post(`/admin/orders/${order.id}/transitions`, {
						state: next,
					});
					if (next === state) {
						break;
					}
				}

				expect(
					(await panel.delete(`/admin/customers/${id}`)).statusCode,
				).toBe(409);
				expect(
					(await panel.get(`/admin/customers/${id}`)).statusCode,
				).toBe(200);
			},
		);

		it("is only for the store's owner", async () => {
			const { id } = await buyer();
			expect(
				(await staffPanel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(403);
			expect((await panel.get(`/admin/customers/${id}`)).statusCode).toBe(
				200,
			);
		});

		it("answers 404 to another store's customer", async () => {
			const { id } = await buyer();
			expect(
				(await otherPanel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(404);
		});
	});
});
