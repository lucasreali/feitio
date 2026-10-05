import type { AsaasApi } from "../../src/payments/adapters/asaas.js";

interface Payment {
	id: string;
	owner: string;
	externalReference: string;
	billingType: string;
	value: number;
	refunded: number;
	status: string;
	deleted: boolean;
}

export interface FakeAsaasRequest {
	method: string;
	path: string;
	credential: string | null;
	body: unknown;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

const refusal = (description: string) =>
	json({ errors: [{ code: "invalid", description }] }, 400);

/**
 * An Asaas in memory, for e2e tests: subaccounts, customers, payments and
 * refunds, each subaccount seeing only its own. `decline` refuses cards,
 * `refuse` refuses the next request with a message, `down` answers 503 to
 * everything.
 */
export function fakeAsaas() {
	const requests: FakeAsaasRequest[] = [];
	const accounts: { apiKey: string; body: Record<string, unknown> }[] = [];
	const customers: { id: string; owner: string; ref: string }[] = [];
	const payments = new Map<string, Payment>();
	let next = 0;
	const id = (prefix: string) => `${prefix}_${++next}`;
	const control = {
		decline: false,
		refuse: null as string | null,
		down: false,
	};

	const route = (
		method: string,
		url: URL,
		credential: string,
		body: Record<string, unknown>,
	): Response => {
		const path = url.pathname;
		const ref = url.searchParams.get("externalReference");
		const own = (paymentId: string) => {
			const payment = payments.get(paymentId);
			return payment?.owner === credential ? payment : undefined;
		};
		if (method === "POST" && path === "/v3/accounts") {
			if (credential !== "root-key") {
				return json({}, 401);
			}
			const account = {
				id: id("acc"),
				walletId: id("wallet"),
				apiKey: id("key"),
			};
			accounts.push({ apiKey: account.apiKey, body });
			return json(account);
		}
		if (method === "GET" && path === "/v3/customers") {
			return json({
				data: customers.filter(
					(c) => c.owner === credential && c.ref === ref,
				),
			});
		}
		if (method === "POST" && path === "/v3/customers") {
			const customer = {
				id: id("cus"),
				owner: credential,
				ref: String(body.externalReference),
			};
			customers.push(customer);
			return json({ id: customer.id });
		}
		if (method === "POST" && path === "/v3/creditCard/tokenizeCreditCard") {
			const card = body.creditCard as { number: string };
			return json({
				creditCardToken: id("tok"),
				creditCardNumber: card.number.slice(-4),
				creditCardBrand: "VISA",
			});
		}
		if (method === "POST" && path === "/v3/payments") {
			if (body.billingType === "CREDIT_CARD" && control.decline) {
				return refusal("Transação não autorizada.");
			}
			const payment: Payment = {
				id: id("pay"),
				owner: credential,
				externalReference: String(body.externalReference),
				billingType: String(body.billingType),
				value: Number(body.value),
				refunded: 0,
				status:
					body.billingType === "CREDIT_CARD"
						? "CONFIRMED"
						: "PENDING",
				deleted: false,
			};
			payments.set(payment.id, payment);
			return json({
				...payment,
				bankSlipUrl: `https://asaas.test/b/${payment.id}`,
			});
		}
		if (method === "GET" && path === "/v3/payments") {
			return json({
				data: [...payments.values()].filter(
					(p) =>
						p.owner === credential && p.externalReference === ref,
				),
			});
		}
		const match = path.match(/^\/v3\/payments\/([^/]+)(\/.*)?$/);
		const payment = match && own(match[1]);
		if (!payment) {
			return json({}, 404);
		}
		if (method === "GET" && !match[2]) {
			return json(payment);
		}
		if (method === "GET" && match[2] === "/pixQrCode") {
			return json({ payload: `pix-${payment.id}`, encodedImage: "aW1n" });
		}
		if (method === "GET" && match[2] === "/identificationField") {
			return json({ identificationField: `line-${payment.id}` });
		}
		if (method === "POST" && match[2] === "/refund") {
			const value = Number(body.value);
			if (value > payment.value - payment.refunded + 1e-9) {
				return refusal("Valor maior que o disponível.");
			}
			payment.refunded += value;
			if (payment.refunded >= payment.value - 1e-9) {
				payment.status = "REFUNDED";
			}
			return json(payment);
		}
		return json({}, 404);
	};

	const fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const credential = new Headers(init?.headers).get("access_token");
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		requests.push({
			method,
			path: url.pathname + url.search,
			credential,
			body,
		});
		if (control.down) {
			return json({}, 503);
		}
		if (control.refuse) {
			const message = control.refuse;
			control.refuse = null;
			return refusal(message);
		}
		return route(method, url, credential ?? "", body);
	};

	const api: AsaasApi = {
		url: "https://asaas.test",
		apiKey: "root-key",
		walletId: "feitio-wallet",
		fetch,
	};

	return {
		api,
		control,
		requests,
		accounts,
		/** The payment Asaas keeps for our reference (our payment id). */
		payment: (reference: string) =>
			[...payments.values()].find(
				(p) => p.externalReference === reference,
			),
		/** Changes a payment as Asaas would, before its webhook. */
		setStatus(paymentId: string, status: string, deleted = false) {
			const payment = payments.get(paymentId);
			if (!payment) {
				throw new Error(`No payment ${paymentId}`);
			}
			payment.status = status;
			payment.deleted = deleted;
		},
	};
}

export type FakeAsaas = ReturnType<typeof fakeAsaas>;
