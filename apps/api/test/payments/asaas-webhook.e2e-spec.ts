import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { DomainEvent } from "../../src/events/domain-event.js";
import { ASAAS_API } from "../../src/payments/adapters/asaas.js";
import { PaymentNotifications } from "../../src/payments/payment-notifications.js";
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
	storeEvents,
	type TestTenant,
} from "../fixtures.js";
import { type FakeAsaas, fakeAsaas } from "./fake-asaas.js";
import { openPaymentAccount } from "./payment-fixtures.js";

describe("Asaas webhook (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let asaas: FakeAsaas;
	let tenant: TestTenant;
	let other: TestTenant;
	let panel: PanelClient;
	let cart: CartClient;
	let variantId: string;
	let webhookToken: string;

	const notify = (
		tenantId: string,
		body: unknown,
		token: string | null = webhookToken,
	) =>
		app.inject({
			method: "POST",
			url: `/webhooks/asaas/${tenantId}`,
			payload: body as object,
			headers: token ? { "asaas-access-token": token } : {},
		});
	const notifications = async () =>
		(await storeEvents(app, tenant)).filter(
			(e) => e.type === "payment.notified",
		);
	/** A Pix under way for a placed order; answers its token and payment. */
	const pixUnderWay = async () => {
		const token = await readyCart(cart, variantId, {
			email: `ana-${crypto.randomUUID()}@example.com`,
		});
		await cart("POST", "/store/cart/place", { token });
		const payment = (
			await cart("POST", "/store/cart/payment", {
				token,
				payload: { method: "pix", taxId: "52998224725" },
			})
		).json<{ id: string }>();
		const charge = asaas.payment(payment.id);
		if (!charge) {
			throw new Error("No charge at Asaas");
		}
		return { token, paymentId: payment.id, gatewayId: charge.id };
	};
	/** Runs the worker's job for a notification, as EventJobs would. */
	const runJob = (event: DomainEvent) =>
		TenantContext.run(tenant, () =>
			app
				.get(TenantDatabase)
				.run((tx) =>
					app
						.get(PaymentNotifications)
						.handle(event, { tx, key: crypto.randomUUID() }),
				),
		);

	beforeAll(async () => {
		asaas = fakeAsaas();
		app = await startApp((b) =>
			b.overrideProvider(ASAAS_API).useValue(asaas.api),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		other = await fixtures.tenant();
		const owner = await fixtures.user();
		await fixtures.member(tenant, owner, "owner");
		await fixtures.shippingMethod(tenant);
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, tenant);
		({ variantId } = await sellableVariant(panel, { stock: 50 }));
		await openPaymentAccount(panel);
		const webhooks = asaas.accounts[0].body.webhooks as {
			authToken: string;
		}[];
		webhookToken = webhooks[0].authToken;
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	// "valid" stands for the store's token, known only once the account opens.
	it.each([
		["no token", () => tenant.id, null],
		["a wrong token", () => tenant.id, "x".repeat(64)],
		["another store's id", () => other.id, "valid"],
		["an unknown store", () => crypto.randomUUID(), "valid"],
		["an id that is no id", () => "nope", "valid"],
	])("refuses a notification with %s", async (_, id, token) => {
		const response = await notify(
			id(),
			{
				id: "evt_x",
				event: "PAYMENT_RECEIVED",
				payment: { id: "pay_x" },
			},
			token === "valid" ? webhookToken : token,
		);
		expect(response.statusCode).toBe(401);
		expect(await notifications()).toEqual([]);
	});

	it("queues each notification once, and ignores what is not about a payment", async () => {
		const body = {
			id: "evt_05b708f961d739ea7eba7e4db318f621&368604920",
			event: "PAYMENT_RECEIVED",
			payment: { object: "payment", id: "pay_123" },
		};
		expect((await notify(tenant.id, body)).statusCode).toBe(200);
		expect((await notify(tenant.id, body)).statusCode).toBe(200);
		expect(
			(await notify(tenant.id, { id: "evt_2", event: "ACCOUNT_STATUS" }))
				.statusCode,
		).toBe(200);

		expect((await notifications()).map((e) => e.payload)).toEqual([
			{ gatewayId: "pay_123" },
		]);
	});

	it("marks the order paid when Asaas says the payment was received", async () => {
		const { token, paymentId, gatewayId } = await pixUnderWay();
		asaas.setStatus(gatewayId, "RECEIVED");

		await runJob({ type: "payment.notified", gatewayId });

		expect(
			(await cart("GET", "/store/cart/payment", { token })).json(),
		).toMatchObject({
			id: paymentId,
			status: "confirmed",
		});
		expect((await cart("GET", "/store/cart", { token })).json().state).toBe(
			"paid",
		);

		// Heard again: nothing changes.
		await runJob({ type: "payment.notified", gatewayId });
		expect((await cart("GET", "/store/cart", { token })).json().state).toBe(
			"paid",
		);
	});

	it("fails a Pix that expired, and lets the buyer pay again", async () => {
		const { token, gatewayId } = await pixUnderWay();
		asaas.setStatus(gatewayId, "OVERDUE");

		await runJob({ type: "payment.notified", gatewayId });

		expect(
			(await cart("GET", "/store/cart/payment", { token })).json().status,
		).toBe("failed");
		const again = await cart("POST", "/store/cart/payment", {
			token,
			payload: { method: "pix", taxId: "52998224725" },
		});
		expect(again.statusCode).toBe(201);
	});

	it("ignores charges of no payment of the store", async () => {
		await expect(
			runJob({ type: "payment.notified", gatewayId: "pay_unknown" }),
		).resolves.toBeUndefined();
	});
});
