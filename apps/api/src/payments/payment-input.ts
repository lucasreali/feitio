import { Cep } from "../domain/cep.js";
import { Email } from "../domain/email.js";
import { Money } from "../domain/money.js";
import { Phone } from "../domain/phone.js";
import { TaxId } from "../domain/tax-id.js";
import {
	complete,
	domain,
	invalid,
	isObject,
	objectBody,
	optionalDomain,
	optionalText,
	requiredText,
} from "../http/request-body.js";
import {
	type CardInput,
	type MerchantAccountInput,
	PAYMENT_METHODS,
	type PaymentMethod,
} from "./payment-gateway.js";

const COMPANY_TYPES = ["MEI", "LIMITED", "INDIVIDUAL", "ASSOCIATION"];

const text = (field: string, max: number) => (value: unknown) =>
	requiredText(value, field, max);

const isDate = (value: unknown): value is string =>
	typeof value === "string" &&
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const amount = (field: string) => (value: unknown) =>
	(Number.isSafeInteger(value) &&
		(value as number) > 0 &&
		Money.parse(value)) ||
	invalid(`${field} must be a positive amount in cents`);

const accountParsers = {
	name: text("name", 120),
	email: domain(Email, "email"),
	taxId: domain(TaxId, "taxId"),
	birthDate: (value: unknown): string | null =>
		isDate(value) ? value : invalid("birthDate must be a YYYY-MM-DD date"),
	companyType: (value: unknown): string | null =>
		COMPANY_TYPES.includes(value as string)
			? (value as string)
			: invalid(`companyType must be one of ${COMPANY_TYPES.join(", ")}`),
	phone: domain(Phone, "phone"),
	monthlyIncome: amount("monthlyIncome"),
	address: (value: unknown) =>
		complete(
			value,
			{
				street: text("address.street", 200),
				number: text("address.number", 20),
				complement: (v: unknown) =>
					optionalText(v, "address.complement", 120),
				neighborhood: text("address.neighborhood", 120),
				cep: domain(Cep, "address.cep"),
			},
			{ complement: null },
		),
};

/**
 * Body of POST /admin/payments/account: who receives the store's sales. A
 * person (CPF) needs a birth date; a company (CNPJ), its type.
 */
export function parseMerchantAccount(
	body: unknown,
): Omit<MerchantAccountInput, "webhook"> {
	const account = complete(body, accountParsers, {
		birthDate: null,
		companyType: null,
	});
	if (account.taxId.length === 11 && !account.birthDate) {
		invalid("A CPF needs birthDate");
	}
	if (account.taxId.length === 14 && !account.companyType) {
		invalid("A CNPJ needs companyType");
	}
	return account;
}

/** Card fields: each message names the field, never its value. */
const cardParsers = {
	holderName: text("card.holderName", 100),
	number: (value: unknown) => {
		const digits =
			typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
		return /^\d{13,19}$/.test(digits)
			? digits
			: invalid("card.number must have 13 to 19 digits");
	},
	expiryMonth: (value: unknown) =>
		typeof value === "string" && /^(0[1-9]|1[0-2])$/.test(value)
			? value
			: invalid("card.expiryMonth must be 01 to 12"),
	expiryYear: (value: unknown) =>
		typeof value === "string" && /^\d{4}$/.test(value)
			? value
			: invalid("card.expiryYear must have 4 digits"),
	cvv: (value: unknown) =>
		typeof value === "string" && /^\d{3,4}$/.test(value)
			? value
			: invalid("card.cvv must have 3 or 4 digits"),
};

export interface PaymentRequest {
	method: PaymentMethod;
	/** The buyer's tax id, when the store has none for them. */
	taxId: TaxId | null;
	/** The buyer's phone, when the store has none; cards need one. */
	phone: Phone | null;
	card?: CardInput;
}

/** Body of POST /store/cart/payment. */
export function parsePaymentRequest(body: unknown): PaymentRequest {
	const { card, ...fields } = complete(
		body,
		{
			method: (value: unknown) =>
				PAYMENT_METHODS.includes(value as PaymentMethod)
					? (value as PaymentMethod)
					: invalid(
							`method must be one of ${PAYMENT_METHODS.join(", ")}`,
						),
			taxId: optionalDomain(TaxId, "taxId"),
			phone: optionalDomain(Phone, "phone"),
			card: (value: unknown) =>
				value === null ? null : complete(value, cardParsers, {}),
		},
		{ taxId: null, phone: null, card: null },
	);
	if ((fields.method === "card") !== (card !== null)) {
		invalid("Send card with the card method, and only with it");
	}
	return card ? { ...fields, card } : fields;
}

/** Body of POST /admin/orders/:id/refunds: the amount, or null for all that is left. */
export function parseRefund(body: unknown): Money | null {
	if (body == null || (isObject(body) && Object.keys(body).length === 0)) {
		return null;
	}
	return amount("amount")(objectBody(body, ["amount"]).amount);
}

const brazilDay = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Sao_Paulo",
});

/** The day in Brazil `days` after `now`, as YYYY-MM-DD. */
export function dueDate(now: Date, days: number): string {
	const today = new Date(`${brazilDay.format(now)}T00:00:00Z`);
	today.setUTCDate(today.getUTCDate() + days);
	return today.toISOString().slice(0, 10);
}
