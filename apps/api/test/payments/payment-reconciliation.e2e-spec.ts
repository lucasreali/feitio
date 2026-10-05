import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../../src/database/database.js";
import { orders } from "../../src/database/schemas/orders.js";
import { payments } from "../../src/database/schemas/payments.js";
import { OrderExpiry } from "../../src/orders/order-expiry.js";
import { ASAAS_API } from "../../src/payments/adapters/asaas.js";
import { PaymentAccounts } from "../../src/payments/payment-accounts.js";
import { PAYMENT_GATEWAY } from "../../src/payments/payment-gateway.js";
import { PaymentReconciliation } from "../../src/payments/payment-reconciliation.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../../src/tenancy/tenant-database.js";
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
} from "../fixtures.js";
import { type FakeAsaas, fakeAsaas } from "./fake-asaas.js";
import { openPaymentAccount } from "./payment-fixtures.js";

// Runs the API (to build orders and payments) and the worker's passes, on
// the API's pool.
describe("Payment reconciliation and deadlines (e2e)", {
	timeout: 30_000,
}, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let asaas: FakeAsaas;
	let tenant: TestTenant;
	let panel: PanelClient;
	let cart: CartClient;
	let variantId: string;

	const inStore = (fn: (tx: TenantTransaction) => Promise<unknown>) =>
		TenantContext.run(tenant, () => app.get(TenantDatabase).run(fn));
	/** Moves the payment's creation back by `minutes`. */
	const agePayment = (id: string, minutes: number) =>
		inStore(async (tx) => {
			await tx
				.update(payments)
				.set({
					createdAt: sql`${payments.createdAt} - make_interval(mins => ${minutes})`,
				})
				.where(eq(payments.id, id as never));
		});
	/** Moves the order's last change back by `hours`, and its payments' due dates by `days`. */
	const ageOrder = (token: string, hours: number, days = 0) =>
		inStore(async (tx) => {
			const [order] = await tx
				.update(orders)
				.set({
					updatedAt: sql`${orders.updatedAt} - make_interval(hours => ${hours})`,
				})
				.where(
					eq(
						orders.tokenHash,
						sql`encode(sha256(${token}::bytea), 'hex')`,
					),
				)
				.returning({ id: orders.id });
			await tx
				.update(payments)
				.set({ dueDate: sql`${payments.dueDate} - ${days}::int` })
				.where(eq(payments.orderId, order.id));
		});
	const placed = async () => {
		const token = await readyCart(cart, variantId, {
			email: `ana-${crypto.randomUUID()}@example.com`,
		});
		await cart("POST", "/store/cart/place", { token });
		return token;
	};
	const pay = async (token: string, method = "pix") =>
		cart("POST", "/store/cart/payment", {
			token,
			payload: { method, taxId: "52998224725" },
		});
	const latest = async (token: string) =>
		(await cart("GET", "/store/cart/payment", { token })).json();
	const state = async (token: string) =>
		(await cart("GET", "/store/cart", { token })).json().state;
	const reconcile = (now?: Date) =>
		new PaymentReconciliation(
			app.get(DATABASE),
			app.get(TenantDatabase),
			app.get(PaymentAccounts),
			app.get(PAYMENT_GATEWAY),
		).reconcile(now);
	const expire = () =>
		new OrderExpiry(app.get(DATABASE), app.get(TenantDatabase)).expire();

	beforeAll(async () => {
		asaas = fakeAsaas();
		app = await startApp((b) =>
			b.overrideProvider(ASAAS_API).useValue(asaas.api),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		const owner = await fixtures.user();
		await fixtures.member(tenant, owner, "owner");
		await fixtures.shippingMethod(tenant);
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, tenant);
		({ variantId } = await sellableVariant(panel, { stock: 50 }));
		await openPaymentAccount(panel);
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("settles pending payments the gateway changed, when no notification came", async () => {
		const old = await placed();
		const recent = await placed();
		const oldPayment = (await pay(old)).json();
		const recentPayment = (await pay(recent)).json();
		await agePayment(oldPayment.id, 15);
		asaas.setStatus(asaas.payment(oldPayment.id)?.id as string, "RECEIVED");
		asaas.setStatus(
			asaas.payment(recentPayment.id)?.id as string,
			"RECEIVED",
		);

		await reconcile();

		expect((await latest(old)).status).toBe("confirmed");
		expect(await state(old)).toBe("paid");
		// Its notification may still be on the way.
		expect((await latest(recent)).status).toBe("pending");
	});

	it("fails a payment the gateway never got, and one whose charge never reached the buyer", async () => {
		const lost = await placed();
		asaas.control.down = true;
		expect((await pay(lost)).statusCode).toBe(502);
		asaas.control.down = false;
		const { id } = await latest(lost);

		await agePayment(id, 15);
		await reconcile();
		expect((await latest(lost)).status).toBe("pending");

		await agePayment(id, 20);
		await reconcile();
		expect((await latest(lost)).status).toBe("failed");
		expect((await pay(lost)).statusCode).toBe(201);
	});

	it("waits for a boleto under way before cancelling its order", async () => {
		const boleto = await placed();
		expect((await pay(boleto, "boleto")).statusCode).toBe(201);
		const unpaid = await placed();
		await ageOrder(boleto, 25);
		await ageOrder(unpaid, 25);

		await expire();

		expect(await state(boleto)).toBe("awaiting_payment");
		expect(await state(unpaid)).toBe("cancelled");

		// Past its due date and the days a bank takes, it is cancelled too.
		await ageOrder(boleto, 0, 10);
		await expire();
		expect(await state(boleto)).toBe("cancelled");
	});
});
