import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { payments } from "../../src/database/schemas/payments.js";
import { ASAAS_API } from "../../src/payments/adapters/asaas.js";
import { PAYMENT_SETTINGS } from "../../src/payments/payment-settings.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../../src/tenancy/tenant-database.js";
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
} from "../fixtures.js";
import { type FakeAsaas, fakeAsaas } from "./fake-asaas.js";
import { openPaymentAccount } from "./payment-fixtures.js";

const card = {
	holderName: "ANA SOUZA",
	number: "4111 1111 1111 1111",
	expiryMonth: "05",
	expiryYear: "2030",
	cvv: "318",
};

// Each test builds orders through the API, a remote round trip per step.
describe("Store payment (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let asaas: FakeAsaas;
	let tenant: TestTenant;
	let panel: PanelClient;
	let cart: CartClient;
	let variantId: string;

	/** An order placed and awaiting payment; answers its cart token. */
	const placedOrder = async (
		email = `ana-${crypto.randomUUID()}@example.com`,
	) => {
		const token = await readyCart(cart, variantId, { email });
		const placed = await placeOrder(cart, token);
		expect(placed.statusCode).toBe(200);
		return token;
	};
	const pay = (token: string, payload: unknown) =>
		cart("POST", "/store/cart/payment", { token, payload });
	const storedPayments = () =>
		TenantContext.run(tenant, () =>
			app.get(TenantDatabase).run((tx) => tx.select().from(payments)),
		);

	beforeAll(async () => {
		asaas = fakeAsaas();
		// A fee of its own, whatever .env.test says, so the split is always sent.
		app = await startApp((b) =>
			b
				.overrideProvider(ASAAS_API)
				.useValue(asaas.api)
				.overrideProvider(PAYMENT_SETTINGS)
				.useValue({
					feePercent: 2.5,
					publicApiUrl: process.env.PUBLIC_API_URL,
				}),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		const owner = await fixtures.user();
		await fixtures.member(tenant, owner, "owner");
		await fixtures.shippingMethod(tenant);
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, tenant);
		({ variantId } = await sellableVariant(panel, {
			price: 4990,
			stock: 50,
		}));
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("takes no payment before the store opens its account", async () => {
		const token = await placedOrder();
		const response = await pay(token, {
			method: "pix",
			taxId: "52998224725",
		});
		expect(response.statusCode).toBe(409);
		expect(asaas.requests).toEqual([]);
		await openPaymentAccount(panel);
	});

	it("charges a Pix for the order's total, with Feitio's part, and shows its code", async () => {
		const token = await placedOrder();
		const order = (await cart("GET", "/store/cart", { token })).json();

		const response = await pay(token, {
			method: "pix",
			taxId: "529.982.247-25",
		});

		expect(response.statusCode).toBe(201);
		const payment = response.json();
		expect(payment).toMatchObject({
			method: "pix",
			status: "pending",
			amount: order.total,
			refunded: 0,
			failure: null,
			dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			pix: { code: expect.stringMatching(/^pix-pay_/), image: "aW1n" },
		});
		const charged = asaas.payment(payment.id);
		expect(charged).toMatchObject({
			billingType: "PIX",
			value: order.total / 100,
		});
		const sent = asaas.requests.find(
			(r) => r.method === "POST" && r.path === "/v3/payments",
		)?.body as Record<string, unknown>;
		expect(sent).toMatchObject({
			externalReference: payment.id,
			description: `Pedido ${order.number}`,
			split: [
				{
					walletId: "feitio-wallet",
					percentualValue: 2.5,
				},
			],
		});

		expect(
			(await cart("GET", "/store/cart/payment", { token })).json(),
		).toEqual(payment);
		// One payment under way at a time, and the order cannot change meanwhile.
		expect(
			(await pay(token, { method: "boleto", taxId: "52998224725" }))
				.statusCode,
		).toBe(409);
		expect(
			(await cart("POST", "/store/cart/reopen", { token })).statusCode,
		).toBe(409);
		expect((await cart("GET", "/store/cart", { token })).json().state).toBe(
			"awaiting_payment",
		);
	});

	it("charges a boleto due in 3 days, with its line to pay", async () => {
		const token = await placedOrder();
		const payment = (
			await pay(token, { method: "boleto", taxId: "52998224725" })
		).json();
		expect(payment.boleto).toEqual({
			line: expect.stringMatching(/^line-pay_/),
			url: expect.stringMatching(/^https:\/\/asaas.test\/b\//),
		});
		const days =
			(Date.parse(payment.dueDate) -
				Date.parse(payment.createdAt.slice(0, 10))) /
			86_400_000;
		expect(days).toBeGreaterThanOrEqual(2);
		expect(days).toBeLessThanOrEqual(4);
	});

	it("pays the order with an approved card, keeping only its brand and last digits", async () => {
		const token = await placedOrder();
		const response = await pay(token, {
			method: "card",
			card,
			taxId: "52998224725",
			phone: "(11) 98888-7777",
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({
			status: "confirmed",
			card: { brand: "VISA", last4: "1111" },
		});
		expect((await cart("GET", "/store/cart", { token })).json().state).toBe(
			"paid",
		);

		const charge = asaas.requests.filter(
			(r) => r.method === "POST" && r.path === "/v3/payments",
		);
		expect(JSON.stringify(charge.at(-1)?.body)).not.toContain(
			"4111111111111111",
		);
		const stored = JSON.stringify(await storedPayments());
		expect(stored).not.toContain("4111111111111111");
		expect(stored).not.toContain('"318"');
	});

	it("answers a declined card as a failed payment, and takes another one", async () => {
		const token = await placedOrder();
		asaas.control.decline = true;
		const declined = await pay(token, {
			method: "card",
			card,
			taxId: "52998224725",
			phone: "11988887777",
		});
		asaas.control.decline = false;

		expect(declined.statusCode).toBe(201);
		expect(declined.json()).toMatchObject({
			status: "failed",
			failure: "Transação não autorizada.",
		});
		expect((await cart("GET", "/store/cart", { token })).json().state).toBe(
			"awaiting_payment",
		);
		const pix = await pay(token, { method: "pix", taxId: "52998224725" });
		expect(pix.statusCode).toBe(201);
		expect(pix.json().status).toBe("pending");
	});

	it("keeps the payment to be checked when the gateway does not answer", async () => {
		const token = await placedOrder();
		asaas.control.down = true;
		const response = await pay(token, {
			method: "pix",
			taxId: "52998224725",
		});
		asaas.control.down = false;

		expect(response.statusCode).toBe(502);
		const payment = (
			await cart("GET", "/store/cart/payment", { token })
		).json();
		expect(payment.status).toBe("pending");
	});

	it.each([
		["a buyer without a tax id", { method: "pix" }, 400],
		[
			"a card without a phone",
			{ method: "card", card, taxId: "52998224725" },
			400,
		],
		[
			"an invalid card",
			{ method: "card", card: { ...card, cvv: "1" } },
			400,
		],
	])("refuses %s", async (_, payload, status) => {
		const token = await placedOrder();
		expect((await pay(token, payload)).statusCode).toBe(status);
	});

	it("pays only orders awaiting payment", async () => {
		const token = (await cart("POST", "/store/cart")).json().token;
		expect(
			(await pay(token, { method: "pix", taxId: "52998224725" }))
				.statusCode,
		).toBe(409);
		expect(
			(await cart("GET", "/store/cart/payment", { token })).statusCode,
		).toBe(404);
		expect((await pay("unknown-token", { method: "pix" })).statusCode).toBe(
			404,
		);
	});

	it("records the payments in the order's history", async () => {
		const token = await placedOrder();
		await pay(token, {
			method: "card",
			card,
			taxId: "52998224725",
			phone: "11988887777",
		});
		const order = (await panel.get("/admin/orders?state=paid")).json()
			.items[0];
		const history = (
			await panel.get(`/admin/orders/${order.id}/history`)
		).json();
		expect(
			history.items
				.filter((e: { kind: string }) => e.kind === "payment")
				.map((e: { data: { status: string } }) => e.data.status),
		).toEqual(["confirmed", "pending"]);
	});
});
