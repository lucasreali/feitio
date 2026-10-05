import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { DATABASE } from "../../src/database/database.js";
import { orders } from "../../src/database/schemas/orders.js";
import { OrderExpiry } from "../../src/orders/order-expiry.js";
import { SessionService } from "../../src/session/session.service.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../../src/tenancy/tenant-database.js";
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

const HOUR = 60 * 60 * 1000;

interface OrderSummary {
	id: string;
	number: number | null;
	state: string;
}

// Runs the API (to build orders) and the worker's expiry against the real
// PostgreSQL and Valkey in .env.
describe("Order expiry (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;
	let cart: CartClient;

	/** Moves the order's last change back by `hours`. */
	const age = (id: string, hours: number) =>
		TenantContext.run(store, () =>
			app.get(TenantDatabase).run(async (tx) => {
				const [{ updatedAt }] = await tx
					.select({ updatedAt: orders.updatedAt })
					.from(orders)
					.where(eq(orders.id, id as never));
				await tx
					.update(orders)
					.set({
						updatedAt: new Date(updatedAt.getTime() - hours * HOUR),
					})
					.where(eq(orders.id, id as never));
			}),
		);
	const ordersIn = async (state: string) =>
		(await panel.get(`/admin/orders?state=${state}&pageSize=100`)).json<{
			items: OrderSummary[];
		}>().items;
	/** An order awaiting payment of 2 units; answers its id and variant. */
	const unpaid = async () => {
		const { variantId } = await sellableVariant(panel, { stock: 5 });
		const token = await readyCart(cart, variantId, { quantity: 2 });
		const { number } = (
			await cart("POST", "/store/cart/place", { token })
		).json<{ number: number }>();
		const [{ id }] = (await ordersIn("awaiting_payment")).filter(
			(order) => order.number === number,
		);
		return { id, variantId };
	};
	// Built on the API's pool, not the worker module's: the pooler takes few
	// connections. Not started, so only the calls below run it.
	const expire = () =>
		new OrderExpiry(app.get(DATABASE), app.get(TenantDatabase)).expire();

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		await fixtures.shippingMethod(store);
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

	it("cancels orders awaiting payment for a day, releasing their stock", async () => {
		const stale = await unpaid();
		const fresh = await unpaid();
		await age(stale.id, 25);
		await age(fresh.id, 23);

		await expire();

		expect(
			(await panel.get(`/admin/orders/${stale.id}`)).json(),
		).toMatchObject({ state: "cancelled" });
		expect(
			(
				await panel.get(`/admin/variants/${stale.variantId}/stock`)
			).json(),
		).toMatchObject({ available: 5, reserved: 0 });
		const history = (
			await panel.get(`/admin/orders/${stale.id}/history`)
		).json<{ items: { data: unknown; user: unknown }[] }>().items;
		expect(history[0]).toMatchObject({
			data: { from: "awaiting_payment", to: "cancelled" },
			user: null,
		});
		expect(
			(await panel.get(`/admin/orders/${fresh.id}`)).json(),
		).toMatchObject({ state: "awaiting_payment" });
	});

	it("leaves paid orders alone, however old", async () => {
		const order = await unpaid();
		await panel.post(`/admin/orders/${order.id}/transitions`, {
			state: "paid",
		});
		await age(order.id, 24 * 60);

		await expire();

		expect(
			(await panel.get(`/admin/orders/${order.id}`)).json(),
		).toMatchObject({ state: "paid" });
	});

	it("removes carts untouched for 30 days", async () => {
		await cart("POST", "/store/cart");
		await cart("POST", "/store/cart");
		// The store's only carts: every other order here was placed.
		const [newest, oldest] = await ordersIn("cart");
		await age(oldest.id, 31 * 24);
		await age(newest.id, 29 * 24);

		await expire();

		expect((await ordersIn("cart")).map((order) => order.id)).toEqual([
			newest.id,
		]);
	});
});
