import type { Cep } from "../domain/cep.js";
import type { Email } from "../domain/email.js";
import type { Money } from "../domain/money.js";
import type { Phone } from "../domain/phone.js";
import type { TaxId } from "../domain/tax-id.js";

export const PAYMENT_METHODS = ["pix", "boleto", "card"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * A charge's situation. `pending`: waiting for the buyer (or the card's
 * risk analysis). `confirmed`: paid. `failed`: refused, expired or removed.
 * `refunded`: the whole amount went back.
 */
export type PaymentStatus = "pending" | "confirmed" | "failed" | "refunded";

/** The store's own account at the gateway, which receives its sales. */
export interface MerchantAccountInput {
	name: string;
	email: Email;
	taxId: TaxId;
	/** YYYY-MM-DD; required for a CPF. */
	birthDate: string | null;
	/** Required for a CNPJ: `MEI`, `LIMITED`, `INDIVIDUAL` or `ASSOCIATION`. */
	companyType: string | null;
	phone: Phone;
	monthlyIncome: Money;
	address: {
		street: string;
		number: string;
		complement: string | null;
		neighborhood: string;
		cep: Cep;
	};
	/** Where the gateway notifies the store's payments, with the token it sends. */
	webhook: { url: string; token: string };
}

export interface MerchantAccount {
	accountId: string;
	/** Where split parts of payments go. */
	walletId: string;
	/** The account's credential: secret, and answered only once. */
	credential: string;
}

/** Who pays, as the gateway registers them. */
export interface Payer {
	/** Our customer id, so the gateway keeps one customer per buyer. */
	reference: string;
	name: string;
	email: Email;
	taxId: TaxId;
	phone: Phone | null;
	cep: Cep | null;
	addressNumber: string | null;
}

/** Card data as the buyer typed it: only in memory, never stored nor logged. */
export interface CardInput {
	holderName: string;
	number: string;
	expiryMonth: string;
	expiryYear: string;
	cvv: string;
}

export interface ChargeInput {
	/** Our payment id: the gateway keeps it, to find the charge by it. */
	reference: string;
	method: PaymentMethod;
	amount: Money;
	/** YYYY-MM-DD in Brazil's time. */
	dueDate: string;
	description: string;
	payer: Payer;
	/** For `card` only. */
	card?: CardInput;
	/** The buyer's IP address; the gateway asks it for cards. */
	remoteIp: string;
	/** Feitio's part of the payment, in percent, split at the gateway. */
	platformFeePercent: number;
}

/** What the buyer needs to pay, by method. */
export interface PaymentDetails {
	pix?: { code: string; image: string };
	boleto?: { line: string; url: string };
	card?: { brand: string; last4: string };
}

export interface GatewayCharge extends PaymentDetails {
	id: string;
	/** Our payment id, as sent when charging. */
	reference: string | null;
	status: PaymentStatus;
}

/** The gateway refused the request (a declined card, invalid data); `message` is for people. */
export class GatewayRefusal extends Error {}

/**
 * A payment gateway, behind which each store charges its buyers in its own
 * account, with Feitio's part split off. Asaas is the adapter today.
 * Methods throw GatewayRefusal when the gateway refuses, and other errors
 * when it fails to answer.
 */
export interface PaymentGateway {
	createAccount(input: MerchantAccountInput): Promise<MerchantAccount>;
	charge(credential: string, input: ChargeInput): Promise<GatewayCharge>;
	/** The charge by the gateway's id or by our reference; null when there is none. */
	find(
		credential: string,
		by: { id: string } | { reference: string },
	): Promise<GatewayCharge | null>;
	refund(credential: string, id: string, amount: Money): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
