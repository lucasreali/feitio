import { HttpsUrl } from "../domain/https-url.js";
import { Money } from "../domain/money.js";
import { ThemeValue } from "../domain/theme-value.js";
import {
	type OrderEmailData,
	orderEmail,
	orderEmailKind,
	type StoreBrand,
} from "./order-emails.js";

const store: StoreBrand = {
	name: "Loja da Ana",
	logoUrl: null,
	theme: {},
};

const order: OrderEmailData = {
	number: 7,
	customerName: "Ana Souza",
	lines: [
		{ productName: "Camiseta", quantity: 2, total: Money.parse(9980) },
		{ productName: "Boné", quantity: 1, total: Money.parse(3500) },
	],
	subtotal: Money.parse(13480),
	discount: Money.parse(0),
	shipping: Money.parse(1500),
	total: Money.parse(14980),
	shippingMethodName: "Frete fixo",
	trackingCode: null,
};

/** Whitespace as one space, so assertions do not depend on line breaks. */
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("orderEmailKind", () => {
	it.each([
		["cart", "awaiting_payment", "received"],
		["awaiting_payment", "paid", "paid"],
		["preparing", "shipped", "shipped"],
		["awaiting_payment", "cancelled", "cancelled"],
		["paid", "cancelled", "cancelled"],
	] as const)("%s to %s is %s", (from, to, kind) => {
		expect(orderEmailKind(from, to)).toBe(kind);
	});

	it.each([
		["awaiting_payment", "cart"],
		["paid", "preparing"],
		["shipped", "delivered"],
	] as const)("sends nothing from %s to %s", (from, to) => {
		expect(orderEmailKind(from, to)).toBeNull();
	});
});

describe("orderEmail", () => {
	it.each([
		["received", "Recebemos seu pedido nº 7"],
		["paid", "Pagamento do pedido nº 7 confirmado"],
		["shipped", "Seu pedido nº 7 foi enviado"],
		["cancelled", "Pedido nº 7 cancelado"],
	] as const)("names the %s e-mail after the order", (kind, subject) => {
		expect(orderEmail(kind, order, store).subject).toBe(subject);
	});

	it("lists the lines and totals, in reais, in HTML and in text", () => {
		const { html, text } = orderEmail("received", order, store);
		for (const body of [flat(html), flat(text)]) {
			expect(body).toContain("Olá, Ana Souza");
			expect(body).toContain("Camiseta");
			expect(body).toMatch(/2 × .*R\$\s99,80/);
			expect(body).toMatch(/Frete fixo.*R\$\s15,00/);
			expect(body).toMatch(/Total.*R\$\s149,80/);
		}
		expect(flat(text)).not.toContain("Desconto");
	});

	it("shows the discount when there is one", () => {
		const { text } = orderEmail(
			"received",
			{ ...order, discount: Money.parse(1000) },
			store,
		);
		expect(flat(text)).toMatch(/Desconto.*-R\$\s10,00/);
	});

	it("gives the tracking code of a shipped order, when the store set one", () => {
		const shipped = orderEmail(
			"shipped",
			{ ...order, trackingCode: "BR123" },
			store,
		);
		expect(shipped.text).toContain("Código de rastreio: BR123");
		expect(shipped.html).toContain("BR123");
		expect(orderEmail("shipped", order, store).text).not.toContain(
			"rastreio",
		);
		// Set while preparing, it means nothing once the order is cancelled.
		expect(
			orderEmail("cancelled", { ...order, trackingCode: "BR123" }, store)
				.text,
		).not.toContain("BR123");
	});

	it("carries the store's name, logo and colors", () => {
		const { html, text } = orderEmail("paid", order, {
			name: "Loja da Ana",
			logoUrl: HttpsUrl.parse("https://cdn.example.com/logo.png"),
			theme: {
				primary: ThemeValue.parse("#ff5500"),
				"primary-foreground": ThemeValue.parse("white"),
			},
		});
		expect(html).toContain('src="https://cdn.example.com/logo.png"');
		expect(html).toContain('alt="Loja da Ana"');
		expect(html).toContain("background:#ff5500");
		expect(html).toContain("color:white");
		expect(text).toContain("Loja da Ana");
	});

	it("shows the name as the header when the store has no logo", () => {
		const { html } = orderEmail("paid", order, store);
		expect(html).not.toContain("<img");
		expect(html).toContain("Loja da Ana");
	});

	it("escapes what the store and the buyer typed", () => {
		const { html, subject } = orderEmail(
			"received",
			{
				...order,
				customerName: "<b>Ana</b>",
				lines: [
					{
						productName: '<img src=x onerror="alert(1)">',
						quantity: 1,
						total: Money.parse(100),
					},
				],
			},
			{ ...store, name: "A & B <script>" },
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<b>");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("A &amp; B &lt;script&gt;");
		expect(subject).toBe("Recebemos seu pedido nº 7");
	});
});
