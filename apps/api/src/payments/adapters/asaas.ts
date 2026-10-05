import { Inject, Injectable } from "@nestjs/common";
import type { Money } from "../../domain/money.js";
import type { Phone } from "../../domain/phone.js";
import {
	type ChargeInput,
	type GatewayCharge,
	GatewayRefusal,
	type MerchantAccount,
	type MerchantAccountInput,
	type PaymentGateway,
	type PaymentMethod,
	type PaymentStatus,
} from "../payment-gateway.js";

/** How to reach Asaas: Feitio's root account, from the environment. */
export interface AsaasApi {
	/** https://api.asaas.com, or https://api-sandbox.asaas.com outside production. */
	url: string;
	/** Feitio's API key: creates the stores' subaccounts. */
	apiKey: string;
	/** Feitio's wallet, which receives its part of each payment. */
	walletId: string;
	fetch: typeof fetch;
}

export const ASAAS_API = Symbol("ASAAS_API");

const TIMEOUT_MS = 15_000;

const billingTypes: Record<PaymentMethod, string> = {
	pix: "PIX",
	boleto: "BOLETO",
	card: "CREDIT_CARD",
};

/** The events each store's webhook gets: those that change a payment's status. */
const WEBHOOK_EVENTS = [
	"PAYMENT_CONFIRMED",
	"PAYMENT_RECEIVED",
	"PAYMENT_OVERDUE",
	"PAYMENT_DELETED",
	"PAYMENT_RESTORED",
	"PAYMENT_REFUNDED",
	"PAYMENT_PARTIALLY_REFUNDED",
	"PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
	"PAYMENT_APPROVED_BY_RISK_ANALYSIS",
	"PAYMENT_REPROVED_BY_RISK_ANALYSIS",
	"PAYMENT_CHARGEBACK_REQUESTED",
];

/** A payment as Asaas answers it; only the fields we read. */
interface AsaasPayment {
	id: string;
	externalReference?: string | null;
	status: string;
	deleted?: boolean;
	bankSlipUrl?: string | null;
}

const PAID = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];
// The money is still with the store until the refund or the dispute ends.
const HELD = [
	"REFUND_REQUESTED",
	"REFUND_IN_PROGRESS",
	"CHARGEBACK_REQUESTED",
	"CHARGEBACK_DISPUTE",
	"AWAITING_CHARGEBACK_REVERSAL",
];

/** Our status for an Asaas payment. */
export function statusOf(
	payment: Pick<AsaasPayment, "status" | "deleted">,
): PaymentStatus {
	if (payment.deleted) {
		return "failed";
	}
	if (PAID.includes(payment.status) || HELD.includes(payment.status)) {
		return "confirmed";
	}
	if (payment.status === "REFUNDED") {
		return "refunded";
	}
	if (payment.status === "OVERDUE") {
		return "failed";
	}
	return "pending";
}

/** Reais, as Asaas takes amounts. */
const reais = (amount: Money) => amount / 100;

/** Asaas takes phones as DDD and number, without +55. */
const localPhone = (phone: Phone) => phone.replace(/^\+55/, "");

/**
 * Asaas: each store has a subaccount, created with Feitio's key, and
 * charges its buyers with the subaccount's key; Feitio's part goes to
 * Feitio's wallet as a split. Cards are tokenized first and charged by the
 * token. Card data is only sent to Asaas, never kept nor put in errors.
 */
@Injectable()
export class AsaasGateway implements PaymentGateway {
	constructor(@Inject(ASAAS_API) private readonly api: AsaasApi) {}

	async createAccount(input: MerchantAccountInput): Promise<MerchantAccount> {
		const account = await this.call<{
			id: string;
			walletId: string;
			apiKey: string;
		}>(this.api.apiKey, "POST", "/v3/accounts", {
			name: input.name,
			email: input.email,
			cpfCnpj: input.taxId,
			...(input.birthDate && { birthDate: input.birthDate }),
			...(input.companyType && { companyType: input.companyType }),
			mobilePhone: localPhone(input.phone),
			incomeValue: reais(input.monthlyIncome),
			address: input.address.street,
			addressNumber: input.address.number,
			...(input.address.complement && {
				complement: input.address.complement,
			}),
			province: input.address.neighborhood,
			postalCode: input.address.cep,
			webhooks: [
				{
					name: "Feitio",
					url: input.webhook.url,
					email: input.email,
					sendType: "SEQUENTIALLY",
					interrupted: false,
					enabled: true,
					apiVersion: 3,
					authToken: input.webhook.token,
					events: WEBHOOK_EVENTS,
				},
			],
		});
		return {
			accountId: account.id,
			walletId: account.walletId,
			credential: account.apiKey,
		};
	}

	async charge(
		credential: string,
		input: ChargeInput,
	): Promise<GatewayCharge> {
		const customer = await this.customer(credential, input);
		const card =
			input.card && (await this.tokenize(credential, customer, input));
		const payment = await this.call<AsaasPayment>(
			credential,
			"POST",
			"/v3/payments",
			{
				customer,
				billingType: billingTypes[input.method],
				value: reais(input.amount),
				dueDate: input.dueDate,
				description: input.description,
				externalReference: input.reference,
				...(card && {
					creditCardToken: card.creditCardToken,
					remoteIp: input.remoteIp,
				}),
				...(input.platformFeePercent > 0 && {
					split: [
						{
							walletId: this.api.walletId,
							percentualValue: input.platformFeePercent,
						},
					],
				}),
			},
		);
		const charge = await this.withDetails(
			credential,
			payment,
			input.method,
		);
		return card
			? {
					...charge,
					card: {
						brand: card.creditCardBrand,
						last4: card.creditCardNumber,
					},
				}
			: charge;
	}

	async find(
		credential: string,
		by: { id: string } | { reference: string },
	): Promise<GatewayCharge | null> {
		const payment =
			"id" in by
				? await this.call<AsaasPayment>(
						credential,
						"GET",
						`/v3/payments/${encodeURIComponent(by.id)}`,
					).catch((error: unknown) => {
						if (error instanceof NotFound) {
							return null;
						}
						throw error;
					})
				: (
						await this.call<{ data: AsaasPayment[] }>(
							credential,
							"GET",
							`/v3/payments?externalReference=${encodeURIComponent(by.reference)}`,
						)
					).data[0];
		return payment ? toCharge(payment) : null;
	}

	async refund(credential: string, id: string, amount: Money): Promise<void> {
		await this.call(
			credential,
			"POST",
			`/v3/payments/${encodeURIComponent(id)}/refund`,
			{ value: reais(amount) },
		);
	}

	/** The buyer's customer in the store's account, created on their first payment. */
	private async customer(
		credential: string,
		{ payer }: ChargeInput,
	): Promise<string> {
		const { data } = await this.call<{ data: { id: string }[] }>(
			credential,
			"GET",
			`/v3/customers?externalReference=${encodeURIComponent(payer.reference)}`,
		);
		if (data[0]) {
			return data[0].id;
		}
		const created = await this.call<{ id: string }>(
			credential,
			"POST",
			"/v3/customers",
			{
				name: payer.name,
				email: payer.email,
				cpfCnpj: payer.taxId,
				...(payer.phone && { mobilePhone: localPhone(payer.phone) }),
				externalReference: payer.reference,
				// The store tells its buyers, not Asaas.
				notificationDisabled: true,
			},
		);
		return created.id;
	}

	private tokenize(
		credential: string,
		customer: string,
		{ card, payer, remoteIp }: ChargeInput,
	) {
		return this.call<{
			creditCardToken: string;
			creditCardNumber: string;
			creditCardBrand: string;
		}>(credential, "POST", "/v3/creditCard/tokenizeCreditCard", {
			customer,
			creditCard: {
				holderName: card?.holderName,
				number: card?.number,
				expiryMonth: card?.expiryMonth,
				expiryYear: card?.expiryYear,
				ccv: card?.cvv,
			},
			creditCardHolderInfo: {
				name: payer.name,
				email: payer.email,
				cpfCnpj: payer.taxId,
				postalCode: payer.cep,
				addressNumber: payer.addressNumber,
				phone: payer.phone && localPhone(payer.phone),
			},
			remoteIp,
		});
	}

	/** The charge, with the Pix code or the boleto's line the buyer pays with. */
	private async withDetails(
		credential: string,
		payment: AsaasPayment,
		method: PaymentMethod,
	): Promise<GatewayCharge> {
		const charge = toCharge(payment);
		const path = `/v3/payments/${encodeURIComponent(payment.id)}`;
		if (method === "pix") {
			const qr = await this.call<{
				encodedImage: string;
				payload: string;
			}>(credential, "GET", `${path}/pixQrCode`);
			return {
				...charge,
				pix: { code: qr.payload, image: qr.encodedImage },
			};
		}
		if (method === "boleto") {
			const slip = await this.call<{ identificationField: string }>(
				credential,
				"GET",
				`${path}/identificationField`,
			);
			return {
				...charge,
				boleto: {
					line: slip.identificationField,
					url: payment.bankSlipUrl ?? "",
				},
			};
		}
		return charge;
	}

	/**
	 * One request to Asaas. 400 is a refusal, with Asaas's descriptions as
	 * the message; anything else not ok fails with only the status, so no
	 * request data reaches logs.
	 */
	private async call<T>(
		credential: string,
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await this.api.fetch(`${this.api.url}${path}`, {
			method,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "Feitio",
				access_token: credential,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (response.status === 400) {
			const { errors } = (await response.json().catch(() => ({}))) as {
				errors?: { description?: string }[];
			};
			throw new GatewayRefusal(
				errors?.map((e) => e.description).join(" ") ||
					"Asaas refused the request",
			);
		}
		if (response.status === 404) {
			throw new NotFound(`Asaas has no ${path}`);
		}
		if (!response.ok) {
			throw new Error(`Asaas answered ${response.status}`);
		}
		return (await response.json()) as T;
	}
}

class NotFound extends Error {}

const toCharge = (payment: AsaasPayment): GatewayCharge => ({
	id: payment.id,
	reference: payment.externalReference ?? null,
	status: statusOf(payment),
});
