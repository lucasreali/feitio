import type { PaymentMethod, PaymentStatus } from "./payment-gateway.js";

export class MerchantAddressDto {
	street: string;
	number: string;
	complement?: string | null;
	neighborhood: string;
	/** 8 digits, with or without the hyphen. */
	cep: string;
}

/** Who receives the store's sales: a person (CPF) or a company (CNPJ). */
export class OpenPaymentAccountDto {
	/** The person's or the company's name. */
	name: string;
	email: string;
	/** CPF or CNPJ. */
	taxId: string;
	/** YYYY-MM-DD; required for a CPF. */
	birthDate?: string;
	/** Required for a CNPJ. */
	companyType?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";
	/** A mobile phone. */
	phone: string;
	/** Monthly income, in cents. */
	monthlyIncome: number;
	address: MerchantAddressDto;
}

export class PaymentAccountDto {
	/** Where the store's part of each payment goes, at the gateway. */
	walletId: string;
	createdAt: Date;
}

export class PaymentCardDto {
	holderName: string;
	/** 13 to 19 digits; spaces and hyphens are ignored. */
	number: string;
	/** 01 to 12. */
	expiryMonth: string;
	/** 4 digits. */
	expiryYear: string;
	/** 3 or 4 digits. */
	cvv: string;
}

/**
 * How the buyer pays. Card data goes only to the gateway: it is never kept
 * nor logged.
 */
export class PayOrderDto {
	method: PaymentMethod;
	/** Only with `card`. */
	card?: PaymentCardDto;
	/** The buyer's CPF or CNPJ, when the store has none for them. */
	taxId?: string;
	/** The buyer's phone, when the store has none; cards need one. */
	phone?: string;
}

export class PixDto {
	/** The Pix "copia e cola" code. */
	code: string;
	/** The QR code, a PNG in base64. */
	image: string;
}

export class BoletoDto {
	/** The typeable line. */
	line: string;
	/** The boleto to print. */
	url: string;
}

export class CardDto {
	brand: string;
	last4: string;
}

export class PaymentDto {
	id: string;
	method: PaymentMethod;
	/**
	 * `pending` (waiting for the buyer, or the card's analysis), `confirmed`
	 * (paid), `failed` (refused, expired or removed) or `refunded` (all of it
	 * went back).
	 */
	status: PaymentStatus;
	/** In cents. */
	amount: number;
	/** What went back to the buyer, in cents. */
	refunded: number;
	/** Why the gateway refused it. */
	failure: string | null;
	/** The last day to pay, YYYY-MM-DD. */
	dueDate: string;
	pix?: PixDto;
	boleto?: BoletoDto;
	card?: CardDto;
	createdAt: Date;
}

export class RefundDto {
	/** In cents; without it, all that is left of the payment. */
	amount?: number;
}
