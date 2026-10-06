import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { TestingModule } from "@nestjs/testing";
import type { DomainEvent } from "../../src/events/domain-event.js";
import {
	EMAIL_SENDER,
	type EmailMessage,
	type EmailSender,
} from "../../src/notifications/email-sender.js";
import { OrderNotifications } from "../../src/notifications/order-notifications.js";
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
	storeEvents,
	type TestTenant,
	testWorker,
} from "../fixtures.js";

/** The id of the order a placement answered, found by its number. */
async function orderId(
	panel: PanelClient,
	placement: { json: <T>() => T },
): Promise<string> {
	const { number } = placement.json<{ number: number }>();
	const listed = await panel.get(`/admin/orders?q=${number}`);
	return listed.json<{ items: { id: string }[] }>().items[0].id;
}

// Orders are built through the API; the worker's handler runs as EventJobs
// would run it, against the real PostgreSQL in .env.test.
describe("Order notifications (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let worker: TestingModule;
	let fixtures: Fixtures;
	let tenant: TestTenant;
	let panel: PanelClient;
	let cart: CartClient;
	let variantId: string;
	let sent: { message: EmailMessage; key: string }[];

	const sender: EmailSender = {
		async send(message, key) {
			sent.push({ message, key });
		},
	};

	/** Places an order for a new buyer; answers the order's id and token. */
	const placed = async (email = `ana-${crypto.randomUUID()}@example.com`) => {
		const token = await readyCart(cart, variantId, { email });
		return {
			id: await orderId(panel, await placeOrder(cart, token)),
			token,
		};
	};
	const placedOrder = async (email?: string) => (await placed(email)).id;
	/** The order's transitions, as the worker gets them. */
	const transitionsOf = async (orderId: string) =>
		(await storeEvents(app, tenant))
			.map(({ type, payload }) => ({ type, ...payload }) as DomainEvent)
			.filter(
				(e) => e.type === "order.transitioned" && e.orderId === orderId,
			);
	const runJob = (event: DomainEvent, key: string = crypto.randomUUID()) =>
		TenantContext.run(tenant, () =>
			worker
				.get(TenantDatabase)
				.run((tx) =>
					worker.get(OrderNotifications).handle(event, { tx, key }),
				),
		);
	const transition = (id: string, state: string) =>
		panel.post(`/admin/orders/${id}/transitions`, { state });

	beforeAll(async () => {
		app = await startApp();
		worker = await testWorker([], (b) =>
			b.overrideProvider(EMAIL_SENDER).useValue(sender),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		const owner = await fixtures.user();
		await fixtures.member(tenant, owner, "owner");
		await fixtures.shippingMethod(tenant);
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, tenant);
		({ variantId } = await sellableVariant(panel, {
			name: "Camiseta",
			price: 4990,
			stock: 50,
		}));
	});

	beforeEach(() => {
		sent = [];
	});

	afterAll(async () => {
		await fixtures.close();
		await worker.close();
		await app.close();
	});

	it("tells the buyer the order was received, once per job", async () => {
		const id = await placedOrder("bia@example.com");
		const [placement] = await transitionsOf(id);

		await runJob(placement, "event-1.order-email");

		expect(sent).toHaveLength(1);
		const [{ message, key }] = sent;
		expect(key).toBe("event-1.order-email");
		expect(message).toMatchObject({
			to: "bia@example.com",
			fromName: tenant.name,
		});
		expect(message.subject).toMatch(/^Recebemos seu pedido nº \d+$/);
		expect(message.text).toContain("Olá, Ana Souza.");
		expect(message.text).toMatch(/1 × Camiseta: R\$\s49,90/);
		expect(message.text).toMatch(/Total: R\$\s64,90/);
	});

	it("sends in the store's name, logo and colors", async () => {
		const other = await fixtures.tenant();
		await fixtures.query(
			`insert into store_settings (tenant_id, display_name, logo_url, theme) values ($1, 'Loja da Bia', 'https://cdn.example.com/bia.png', '{"primary": "#ff5500"}')`,
			[other.id],
		);
		const otherOwner = await fixtures.user();
		await fixtures.member(other, otherOwner, "owner");
		await fixtures.shippingMethod(other);
		const otherPanel = panelClient(app, await signIn(app, otherOwner));
		const otherCart = cartClient(app, other);
		const product = await sellableVariant(otherPanel);
		const token = await readyCart(otherCart, product.variantId);
		const id = await orderId(
			otherPanel,
			await placeOrder(otherCart, token),
		);
		const [placement] = (await storeEvents(app, other))
			.map(({ type, payload }) => ({ type, ...payload }) as DomainEvent)
			.filter((e) => e.type === "order.transitioned" && e.orderId === id);

		await TenantContext.run(other, () =>
			worker
				.get(TenantDatabase)
				.run((tx) =>
					worker
						.get(OrderNotifications)
						.handle(placement, { tx, key: crypto.randomUUID() }),
				),
		);

		const [{ message }] = sent;
		expect(message.fromName).toBe("Loja da Bia");
		expect(message.html).toContain('src="https://cdn.example.com/bia.png"');
		expect(message.html).toContain("background:#ff5500");
	});

	it("follows the order: paid, shipped with its tracking code, cancelled", async () => {
		const shipped = await placedOrder();
		await transition(shipped, "paid");
		await transition(shipped, "preparing");
		await panel.put(`/admin/orders/${shipped}/shipment`, {
			trackingCode: "AA123456789BR",
			labelUrl: null,
		});
		await transition(shipped, "shipped");
		const cancelled = await placedOrder();
		await transition(cancelled, "cancelled");

		for (const event of [
			...(await transitionsOf(shipped)),
			...(await transitionsOf(cancelled)),
		]) {
			await runJob(event);
		}

		expect(sent.map(({ message }) => message.subject)).toEqual([
			expect.stringMatching(/^Recebemos seu pedido/),
			expect.stringMatching(/^Pagamento do pedido nº \d+ confirmado$/),
			expect.stringMatching(/^Seu pedido nº \d+ foi enviado$/),
			expect.stringMatching(/^Recebemos seu pedido/),
			expect.stringMatching(/^Pedido nº \d+ cancelado$/),
		]);
		expect(sent[2].message.text).toContain(
			"Código de rastreio: AA123456789BR",
		);
	});

	it("sends nothing when the buyer takes the order back to the cart", async () => {
		const { id, token } = await placed();
		await cart("POST", "/store/cart/reopen", { token });
		const [, reopened] = await transitionsOf(id);

		await runJob(reopened);

		expect(reopened).toMatchObject({
			from: "awaiting_payment",
			to: "cart",
		});
		expect(sent).toEqual([]);
	});
});
