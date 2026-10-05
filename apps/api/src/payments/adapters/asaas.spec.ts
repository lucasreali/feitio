import { Cep } from "../../domain/cep.js";
import { Email } from "../../domain/email.js";
import { Money } from "../../domain/money.js";
import { Phone } from "../../domain/phone.js";
import { TaxId } from "../../domain/tax-id.js";
import {
	type ChargeInput,
	GatewayRefusal,
	type MerchantAccountInput,
} from "../payment-gateway.js";
import { AsaasGateway, statusOf } from "./asaas.js";

type Route = (body: unknown) => { status?: number; body: unknown };

/**
 * An Asaas that answers each "METHOD /path?query" with its route, and the
 * requests it got. Unknown requests are 404.
 */
function asaas(routes: Record<string, Route>) {
	const requests: { key: string; headers: Headers; body: unknown }[] = [];
	const fetch = async (url: string | URL | Request, init?: RequestInit) => {
		const { pathname, search } = new URL(String(url));
		const key = `${init?.method ?? "GET"} ${pathname}${search}`;
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		requests.push({ key, headers: new Headers(init?.headers), body });
		const route = routes[key];
		const answer = route ? route(body) : { status: 404, body: {} };
		return new Response(JSON.stringify(answer.body), {
			status: answer.status ?? 200,
		});
	};
	const gateway = new AsaasGateway({
		url: "https://api-sandbox.asaas.com",
		apiKey: "root-key",
		walletId: "feitio-wallet",
		fetch,
	});
	return { gateway, requests };
}

const payer = {
	reference: "customer-1",
	name: "Ana Souza",
	email: Email.parse("ana@example.com"),
	taxId: TaxId.parse("52998224725"),
	phone: Phone.parse("+5511988887777"),
	cep: Cep.parse("01310100"),
	addressNumber: "1000",
};

const charge = (extra: Partial<ChargeInput> = {}): ChargeInput => ({
	reference: "payment-1",
	method: "pix",
	amount: Money.parse(12990),
	dueDate: "2026-10-05",
	description: "Pedido 7 da Loja",
	payer,
	remoteIp: "203.0.113.9",
	platformFeePercent: 2.5,
	...extra,
});

const card = {
	holderName: "ANA SOUZA",
	number: "5162306219378829",
	expiryMonth: "05",
	expiryYear: "2030",
	cvv: "318",
};

/** The customer is new to the account. */
const newCustomer: Record<string, Route> = {
	"GET /v3/customers?externalReference=customer-1": () => ({
		body: { data: [] },
	}),
	"POST /v3/customers": () => ({ body: { id: "cus_1" } }),
};

describe("AsaasGateway", () => {
	it("creates the store's subaccount with its webhook, with Feitio's key", async () => {
		const { gateway, requests } = asaas({
			"POST /v3/accounts": () => ({
				body: { id: "acc_1", walletId: "wallet-1", apiKey: "sub-key" },
			}),
		});
		const input: MerchantAccountInput = {
			name: "Loja da Ana",
			email: Email.parse("loja@example.com"),
			taxId: TaxId.parse("11222333000181"),
			birthDate: null,
			companyType: "MEI",
			phone: Phone.parse("+5511988887777"),
			monthlyIncome: Money.parse(2500000),
			address: {
				street: "Av. Paulista",
				number: "1000",
				complement: null,
				neighborhood: "Bela Vista",
				cep: Cep.parse("01310100"),
			},
			webhook: {
				url: "https://api.feitio.test/webhooks/asaas/t1",
				token: "w".repeat(64),
			},
		};

		expect(await gateway.createAccount(input)).toEqual({
			accountId: "acc_1",
			walletId: "wallet-1",
			credential: "sub-key",
		});
		const [request] = requests;
		expect(request.headers.get("access_token")).toBe("root-key");
		expect(request.headers.get("user-agent")).toBe("Feitio");
		expect(request.body).toMatchObject({
			name: "Loja da Ana",
			email: "loja@example.com",
			cpfCnpj: "11222333000181",
			companyType: "MEI",
			mobilePhone: "11988887777",
			incomeValue: 25000,
			address: "Av. Paulista",
			addressNumber: "1000",
			province: "Bela Vista",
			postalCode: "01310100",
			webhooks: [
				expect.objectContaining({
					url: "https://api.feitio.test/webhooks/asaas/t1",
					authToken: "w".repeat(64),
					email: "loja@example.com",
					enabled: true,
					sendType: "SEQUENTIALLY",
					events: expect.arrayContaining([
						"PAYMENT_CONFIRMED",
						"PAYMENT_RECEIVED",
						"PAYMENT_REFUNDED",
					]),
				}),
			],
		});
	});

	it("charges a Pix in the store's account, with Feitio's part split off", async () => {
		const { gateway, requests } = asaas({
			...newCustomer,
			"POST /v3/payments": () => ({
				body: {
					id: "pay_1",
					externalReference: "payment-1",
					status: "PENDING",
				},
			}),
			"GET /v3/payments/pay_1/pixQrCode": () => ({
				body: { encodedImage: "iVBOR...", payload: "00020101..." },
			}),
		});

		expect(await gateway.charge("sub-key", charge())).toEqual({
			id: "pay_1",
			reference: "payment-1",
			status: "pending",
			pix: { code: "00020101...", image: "iVBOR..." },
		});
		expect(
			requests.every((r) => r.headers.get("access_token") === "sub-key"),
		).toBe(true);
		const customer = requests.find((r) => r.key === "POST /v3/customers");
		expect(customer?.body).toEqual({
			name: "Ana Souza",
			email: "ana@example.com",
			cpfCnpj: "52998224725",
			mobilePhone: "11988887777",
			externalReference: "customer-1",
			// The store tells its buyers, not Asaas.
			notificationDisabled: true,
		});
		const payment = requests.find((r) => r.key === "POST /v3/payments");
		expect(payment?.body).toEqual({
			customer: "cus_1",
			billingType: "PIX",
			value: 129.9,
			dueDate: "2026-10-05",
			description: "Pedido 7 da Loja",
			externalReference: "payment-1",
			split: [{ walletId: "feitio-wallet", percentualValue: 2.5 }],
		});
	});

	it("reuses the buyer's customer, and charges a boleto without a split when Feitio takes nothing", async () => {
		const { gateway, requests } = asaas({
			"GET /v3/customers?externalReference=customer-1": () => ({
				body: { data: [{ id: "cus_9" }] },
			}),
			"POST /v3/payments": () => ({
				body: {
					id: "pay_2",
					externalReference: "payment-1",
					status: "PENDING",
					bankSlipUrl: "https://sandbox.asaas.com/b/pdf/x",
				},
			}),
			"GET /v3/payments/pay_2/identificationField": () => ({
				body: {
					identificationField:
						"00190000090275928800021932978170187890000005000",
				},
			}),
		});

		const result = await gateway.charge(
			"sub-key",
			charge({ method: "boleto", platformFeePercent: 0 }),
		);

		expect(result.boleto).toEqual({
			line: "00190000090275928800021932978170187890000005000",
			url: "https://sandbox.asaas.com/b/pdf/x",
		});
		expect(requests.map((r) => r.key)).not.toContain("POST /v3/customers");
		const payment = requests.find((r) => r.key === "POST /v3/payments");
		expect(payment?.body).toMatchObject({
			customer: "cus_9",
			billingType: "BOLETO",
		});
		expect(payment?.body).not.toHaveProperty("split");
	});

	it("tokenizes the card and charges the token, never the card", async () => {
		const { gateway, requests } = asaas({
			...newCustomer,
			"POST /v3/creditCard/tokenizeCreditCard": () => ({
				body: {
					creditCardToken: "tok_1",
					creditCardNumber: "8829",
					creditCardBrand: "MASTERCARD",
				},
			}),
			"POST /v3/payments": () => ({
				body: {
					id: "pay_3",
					externalReference: "payment-1",
					status: "CONFIRMED",
				},
			}),
		});

		expect(
			await gateway.charge("sub-key", charge({ method: "card", card })),
		).toEqual({
			id: "pay_3",
			reference: "payment-1",
			status: "confirmed",
			card: { brand: "MASTERCARD", last4: "8829" },
		});
		const tokenize = requests.find((r) =>
			r.key.includes("tokenizeCreditCard"),
		);
		expect(tokenize?.body).toEqual({
			customer: "cus_1",
			creditCard: {
				holderName: "ANA SOUZA",
				number: "5162306219378829",
				expiryMonth: "05",
				expiryYear: "2030",
				ccv: "318",
			},
			creditCardHolderInfo: {
				name: "Ana Souza",
				email: "ana@example.com",
				cpfCnpj: "52998224725",
				postalCode: "01310100",
				addressNumber: "1000",
				phone: "11988887777",
			},
			remoteIp: "203.0.113.9",
		});
		const payment = requests.find((r) => r.key === "POST /v3/payments");
		expect(payment?.body).toMatchObject({
			billingType: "CREDIT_CARD",
			creditCardToken: "tok_1",
			remoteIp: "203.0.113.9",
		});
		expect(JSON.stringify(payment?.body)).not.toContain(card.number);
	});

	it("refuses a declined card with Asaas's message, and no card data in it", async () => {
		const { gateway } = asaas({
			...newCustomer,
			"POST /v3/creditCard/tokenizeCreditCard": () => ({
				body: { creditCardToken: "tok_1" },
			}),
			"POST /v3/payments": () => ({
				status: 400,
				body: {
					errors: [
						{
							code: "invalid_creditCard",
							description: "Transação não autorizada.",
						},
					],
				},
			}),
		});
		const attempt = gateway.charge(
			"sub-key",
			charge({ method: "card", card }),
		);
		await expect(attempt).rejects.toThrow(GatewayRefusal);
		await expect(attempt).rejects.toThrow("Transação não autorizada.");
	});

	it("fails, without refusing, when Asaas does not answer well", async () => {
		const { gateway } = asaas({
			...newCustomer,
			"POST /v3/payments": () => ({ status: 503, body: {} }),
		});
		const attempt = gateway.charge("sub-key", charge());
		await expect(attempt).rejects.toThrow(/503/);
		await expect(attempt).rejects.not.toThrow(GatewayRefusal);
	});

	it("finds a charge by its id or by our reference", async () => {
		const { gateway } = asaas({
			"GET /v3/payments/pay_1": () => ({
				body: {
					id: "pay_1",
					externalReference: "payment-1",
					status: "RECEIVED",
				},
			}),
			"GET /v3/payments?externalReference=payment-2": () => ({
				body: {
					data: [
						{
							id: "pay_2",
							externalReference: "payment-2",
							status: "OVERDUE",
						},
					],
				},
			}),
			"GET /v3/payments?externalReference=payment-3": () => ({
				body: { data: [] },
			}),
		});

		expect(await gateway.find("k", { id: "pay_1" })).toEqual({
			id: "pay_1",
			reference: "payment-1",
			status: "confirmed",
		});
		expect(
			(await gateway.find("k", { reference: "payment-2" }))?.status,
		).toBe("failed");
		expect(await gateway.find("k", { reference: "payment-3" })).toBeNull();
		expect(await gateway.find("k", { id: "pay_404" })).toBeNull();
	});

	it("refunds part of a charge", async () => {
		const { gateway, requests } = asaas({
			"POST /v3/payments/pay_1/refund": () => ({ body: { id: "pay_1" } }),
		});
		await gateway.refund("sub-key", "pay_1", Money.parse(1050));
		expect(requests[0].body).toEqual({ value: 10.5 });
	});
});

describe("statusOf", () => {
	it.each([
		[{ status: "PENDING" }, "pending"],
		[{ status: "AWAITING_RISK_ANALYSIS" }, "pending"],
		[{ status: "CONFIRMED" }, "confirmed"],
		[{ status: "RECEIVED" }, "confirmed"],
		[{ status: "RECEIVED_IN_CASH" }, "confirmed"],
		// Money still with the store until the refund or dispute ends.
		[{ status: "REFUND_REQUESTED" }, "confirmed"],
		[{ status: "REFUND_IN_PROGRESS" }, "confirmed"],
		[{ status: "CHARGEBACK_REQUESTED" }, "confirmed"],
		[{ status: "REFUNDED" }, "refunded"],
		[{ status: "OVERDUE" }, "failed"],
		[{ status: "PENDING", deleted: true }, "failed"],
	])("%j is %s", (payment, status) => {
		expect(statusOf(payment)).toBe(status);
	});
});
