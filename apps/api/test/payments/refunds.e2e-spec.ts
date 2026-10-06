import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ASAAS_API } from "../../src/payments/adapters/asaas.js";
import {
	type CartClient,
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	placeOrder,
	readyCart,
	sellableVariant,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";
import { type FakeAsaas, fakeAsaas } from "./fake-asaas.js";
import { openPaymentAccount } from "./payment-fixtures.js";

const card = {
	holderName: "ANA SOUZA",
	number: "4111111111111111",
	expiryMonth: "05",
	expiryYear: "2030",
	cvv: "318",
};

// Each test builds orders through the API, a remote round trip per step.
describe("Payments in the panel and refunds (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let asaas: FakeAsaas;
	let tenant: TestTenant;
	let ownerUser: TestUser;
	let owner: PanelClient;
	let staff: PanelClient;
	let cart: CartClient;
	let variantId: string;

	/** A placed order; answers its id and cart token. */
	const placed = async () => {
		const token = await readyCart(cart, variantId, {
			email: `ana-${crypto.randomUUID()}@example.com`,
		});
		const { number } = (await placeOrder(cart, token)).json();
		const { items } = (await owner.get(`/admin/orders?q=${number}`)).json<{
			items: { id: string }[];
		}>();
		return { id: items[0].id, token };
	};
	/** An order paid by card; answers its id and payment. */
	const paidByCard = async () => {
		const order = await placed();
		const payment = (
			await cart("POST", "/store/cart/payment", {
				token: order.token,
				payload: {
					method: "card",
					card,
					taxId: "52998224725",
					phone: "11988887777",
				},
			})
		).json<{ id: string; amount: number; status: string }>();
		expect(payment.status).toBe("confirmed");
		return { ...order, payment };
	};
	const refund = (orderId: string, payload?: unknown) =>
		owner.post(`/admin/orders/${orderId}/refunds`, payload);

	beforeAll(async () => {
		asaas = fakeAsaas();
		app = await startApp((b) =>
			b.overrideProvider(ASAAS_API).useValue(asaas.api),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		ownerUser = await fixtures.user();
		const staffUser = await fixtures.user();
		await fixtures.member(tenant, ownerUser, "owner");
		await fixtures.member(tenant, staffUser, "staff");
		await fixtures.shippingMethod(tenant);
		owner = panelClient(app, await signIn(app, ownerUser));
		staff = panelClient(app, await signIn(app, staffUser));
		cart = cartClient(app, tenant);
		({ variantId } = await sellableVariant(owner, { stock: 50 }));
		await openPaymentAccount(owner);
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("lists the order's payments, newest first, to any member", async () => {
		const order = await placed();
		asaas.control.decline = true;
		await cart("POST", "/store/cart/payment", {
			token: order.token,
			payload: {
				method: "card",
				card,
				taxId: "52998224725",
				phone: "11988887777",
			},
		});
		asaas.control.decline = false;
		await cart("POST", "/store/cart/payment", {
			token: order.token,
			payload: { method: "pix", taxId: "52998224725" },
		});

		const response = await staff.get(`/admin/orders/${order.id}/payments`);

		expect(response.statusCode).toBe(200);
		expect(
			response
				.json()
				.map((p: { method: string; status: string }) => [
					p.method,
					p.status,
				]),
		).toEqual([
			["pix", "pending"],
			["card", "failed"],
		]);
		expect(
			(await staff.get(`/admin/orders/${crypto.randomUUID()}/payments`))
				.statusCode,
		).toBe(404);
	});

	it("refunds part of a payment, then the rest, recording who did it", async () => {
		const { id, payment } = await paidByCard();

		const part = await refund(id, { amount: 1000 });
		expect(part.statusCode).toBe(200);
		expect(part.json()).toMatchObject({
			status: "confirmed",
			refunded: 1000,
		});

		const rest = await refund(id);
		expect(rest.statusCode).toBe(200);
		expect(rest.json()).toMatchObject({
			status: "refunded",
			refunded: payment.amount,
		});

		const sent = asaas.requests
			.filter((r) => r.path.endsWith("/refund"))
			.map((r) => r.body);
		expect(sent.slice(-2)).toEqual([
			{ value: 10 },
			{ value: (payment.amount - 1000) / 100 },
		]);
		const history = (await owner.get(`/admin/orders/${id}/history`)).json();
		const refunds = history.items.filter(
			(e: { kind: string }) => e.kind === "refund",
		);
		expect(refunds.map((e: { data: unknown }) => e.data)).toEqual([
			{ paymentId: payment.id, amount: payment.amount - 1000 },
			{ paymentId: payment.id, amount: 1000 },
		]);
		expect(refunds[0].user).toMatchObject({ id: ownerUser.id });

		// Nothing is left to refund.
		expect((await refund(id)).statusCode).toBe(409);
	});

	it("refuses refunding more than is left", async () => {
		const { id, payment } = await paidByCard();
		expect(
			(await refund(id, { amount: payment.amount + 1 })).statusCode,
		).toBe(400);
		expect((await refund(id, { amount: 0 })).statusCode).toBe(400);
	});

	it("refunds only paid orders, only by owners", async () => {
		const unpaid = await placed();
		expect((await refund(unpaid.id)).statusCode).toBe(409);
		const { id } = await paidByCard();
		expect(
			(await staff.post(`/admin/orders/${id}/refunds`)).statusCode,
		).toBe(403);
		expect((await refund(crypto.randomUUID())).statusCode).toBe(404);
	});

	it("answers the gateway's refusal as 409, refunding nothing", async () => {
		const { id } = await paidByCard();
		asaas.control.refuse = "Estorno não permitido.";
		const response = await refund(id);
		expect(response.statusCode).toBe(409);
		expect(response.json().message).toBe("Estorno não permitido.");
		const [payment] = (
			await owner.get(`/admin/orders/${id}/payments`)
		).json();
		expect(payment).toMatchObject({ status: "confirmed", refunded: 0 });
	});
});
