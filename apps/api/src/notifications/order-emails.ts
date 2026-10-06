import type { StoreTheme } from "../database/schemas/store-settings.js";
import type { HttpsUrl } from "../domain/https-url.js";
import type { Money } from "../domain/money.js";
import type { OrderState } from "../orders/order-state.js";

/** What makes an e-mail look like the store's. */
export interface StoreBrand {
	name: string;
	logoUrl: HttpsUrl | null;
	theme: StoreTheme;
}

/** The order as its e-mails show it. */
export interface OrderEmailData {
	number: number;
	customerName: string;
	lines: { productName: string; quantity: number; total: Money }[];
	subtotal: Money;
	discount: Money;
	shipping: Money;
	total: Money;
	shippingMethodName: string | null;
	trackingCode: string | null;
}

export type OrderEmailKind = "received" | "paid" | "shipped" | "cancelled";

/** The e-mail the buyer gets for a transition, or null when there is none. */
export function orderEmailKind(
	from: OrderState,
	to: OrderState,
): OrderEmailKind | null {
	if (to === "awaiting_payment" && from === "cart") {
		return "received";
	}
	const kinds: Partial<Record<OrderState, OrderEmailKind>> = {
		paid: "paid",
		shipped: "shipped",
		cancelled: "cancelled",
	};
	return kinds[to] ?? null;
}

const copy: Record<
	OrderEmailKind,
	{ subject: (n: number) => string; intro: string }
> = {
	received: {
		subject: (n) => `Recebemos seu pedido nº ${n}`,
		intro: "Recebemos seu pedido. Assim que o pagamento for confirmado, avisaremos você.",
	},
	paid: {
		subject: (n) => `Pagamento do pedido nº ${n} confirmado`,
		intro: "O pagamento do seu pedido foi confirmado. Agora vamos separá-lo para envio.",
	},
	shipped: {
		subject: (n) => `Seu pedido nº ${n} foi enviado`,
		intro: "Seu pedido foi enviado.",
	},
	cancelled: {
		subject: (n) => `Pedido nº ${n} cancelado`,
		intro: "Seu pedido foi cancelado. Se já pagou, o valor será devolvido pela loja.",
	},
};

const brl = new Intl.NumberFormat("pt-BR", {
	style: "currency",
	currency: "BRL",
});
const reais = (cents: Money) => brl.format(cents / 100);

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c] ?? c,
	);

/** The rows under the lines: label and amount. */
function totals(order: OrderEmailData): [string, string][] {
	return [
		["Subtotal", reais(order.subtotal)],
		...(order.discount > 0
			? [["Desconto", `-${reais(order.discount)}`] as [string, string]]
			: []),
		[
			order.shippingMethodName
				? `Frete (${order.shippingMethodName})`
				: "Frete",
			reais(order.shipping),
		],
		["Total", reais(order.total)],
	];
}

/** The order's e-mail of that kind, in the store's name, logo and colors. */
export function orderEmail(
	kind: OrderEmailKind,
	order: OrderEmailData,
	store: StoreBrand,
): { subject: string; html: string; text: string } {
	const subject = copy[kind].subject(order.number);
	const tracking =
		kind === "shipped" && order.trackingCode
			? `Código de rastreio: ${order.trackingCode}`
			: null;
	const lines = order.lines.map(
		(line) =>
			[
				`${line.quantity} × ${line.productName}`,
				reais(line.total),
			] as const,
	);
	const sums = totals(order);

	const text = [
		store.name,
		"",
		`Olá, ${order.customerName}.`,
		"",
		copy[kind].intro,
		...(tracking ? ["", tracking] : []),
		"",
		`Pedido nº ${order.number}`,
		...lines.map(([what, amount]) => `${what}: ${amount}`),
		"",
		...sums.map(([label, amount]) => `${label}: ${amount}`),
	].join("\n");

	// Plain CSS values (ThemeValue), escaped again as attribute text.
	const primary = escapeHtml(store.theme.primary ?? "#111111");
	const onPrimary = escapeHtml(
		store.theme["primary-foreground"] ?? "#ffffff",
	);
	const header = store.logoUrl
		? `<img src="${escapeHtml(store.logoUrl)}" alt="${escapeHtml(store.name)}" style="max-height:48px">`
		: `<strong style="font-size:20px">${escapeHtml(store.name)}</strong>`;
	const row = (left: string, right: string, bold = false) =>
		`<tr><td style="padding:4px 0${bold ? ";font-weight:bold" : ""}">${escapeHtml(left)}</td><td style="padding:4px 0;text-align:right${bold ? ";font-weight:bold" : ""}">${escapeHtml(right)}</td></tr>`;

	const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff">
<tr><td style="padding:20px 24px;background:${primary};color:${onPrimary}">${header}</td></tr>
<tr><td style="padding:24px">
<p>Olá, ${escapeHtml(order.customerName)}.</p>
<p>${escapeHtml(copy[kind].intro)}</p>
${tracking ? `<p><strong>${escapeHtml(tracking)}</strong></p>` : ""}
<h2 style="font-size:16px">Pedido nº ${order.number}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${lines.map(([what, amount]) => row(what, amount)).join("\n")}
</table>
<hr style="border:none;border-top:1px solid #e4e4e7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${sums.map(([label, amount], i) => row(label, amount, i === sums.length - 1)).join("\n")}
</table>
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#71717a">${escapeHtml(store.name)}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

	return { subject, html, text };
}
