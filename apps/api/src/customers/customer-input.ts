import { Cep } from "../domain/cep.js";
import { Email } from "../domain/email.js";
import { CustomerGroupId } from "../domain/ids.js";
import { Phone } from "../domain/phone.js";
import { BrazilianState } from "../domain/state.js";
import { TaxId } from "../domain/tax-id.js";
import {
	idList,
	invalid,
	objectBody,
	optionalText,
	requiredText,
} from "../http/request-body.js";

const NAME_MAX = 120;

/** A value of a domain type, or a 400 naming the field. */
const domain =
	<T>(type: { tryParse(value: string): T | null }, field: string) =>
	(value: unknown): T =>
		(typeof value === "string" && type.tryParse(value)) ||
		invalid(`${field} is invalid`);

/** null, or a value of a domain type. */
const optionalDomain =
	<T>(type: { tryParse(value: string): T | null }, field: string) =>
	(value: unknown): T | null =>
		value === null ? null : domain(type, field)(value);

const flag = (field: string) => (value: unknown) =>
	typeof value === "boolean"
		? value
		: invalid(`${field} must be true or false`);

const text = (field: string, max: number) => (value: unknown) =>
	requiredText(value, field, max);

type Parsers = Record<string, (value: unknown) => unknown>;
type Parsed<P extends Parsers> = { [K in keyof P]: ReturnType<P[K]> };

/** The fields sent, each parsed; at least one, and no unknown field. */
function changes<P extends Parsers>(
	body: unknown,
	parsers: P,
): Partial<Parsed<P>> {
	const fields = objectBody(body, Object.keys(parsers));
	return Object.fromEntries(
		Object.entries(fields).map(([field, value]) => [
			field,
			parsers[field](value),
		]),
	) as Partial<Parsed<P>>;
}

/** Every field parsed: missing ones are refused, or take their default. */
function complete<P extends Parsers>(
	body: unknown,
	parsers: P,
	defaults: Partial<Parsed<P>>,
): Parsed<P> {
	const sent = changes(body, parsers);
	const missing = Object.keys(parsers).filter(
		(field) => !(field in sent) && !(field in defaults),
	);
	if (missing.length > 0) {
		invalid(`Missing fields: ${missing.join(", ")}`);
	}
	return { ...defaults, ...sent } as Parsed<P>;
}

/** What identifies a customer, shared by the panel and the stores. */
export const profileParsers = {
	name: text("name", NAME_MAX),
	phone: optionalDomain(Phone, "phone"),
	taxId: optionalDomain(TaxId, "taxId"),
};

const customerParsers = {
	email: domain(Email, "email"),
	...profileParsers,
	groupIds: (value: unknown) => idList(value, "groupIds", CustomerGroupId),
};

export type NewCustomer = Parsed<typeof customerParsers>;
export type CustomerChanges = Partial<NewCustomer>;

/** Body of POST /admin/customers: a customer without an account. */
export function parseNewCustomer(body: unknown): NewCustomer {
	return complete(body, customerParsers, {
		phone: null,
		taxId: null,
		groupIds: [],
	});
}

/** Body of PATCH /admin/customers/:id. */
export function parseCustomerChanges(body: unknown): CustomerChanges {
	return changes(body, customerParsers);
}

const addressParsers = {
	recipient: text("recipient", NAME_MAX),
	phone: optionalDomain(Phone, "phone"),
	cep: domain(Cep, "cep"),
	street: text("street", 200),
	number: text("number", 20),
	complement: (value: unknown) => optionalText(value, "complement", 120),
	neighborhood: text("neighborhood", NAME_MAX),
	city: text("city", NAME_MAX),
	state: domain(BrazilianState, "state"),
	/** The address becomes the customer's default for shipping (or stops being it). */
	defaultShipping: flag("defaultShipping"),
	defaultBilling: flag("defaultBilling"),
};

export type NewAddress = Parsed<typeof addressParsers>;
export type AddressChanges = Partial<NewAddress>;

/** Body of a new address, in the panel and in the stores. */
export function parseNewAddress(body: unknown): NewAddress {
	return complete(body, addressParsers, {
		phone: null,
		complement: null,
		defaultShipping: false,
		defaultBilling: false,
	});
}

/** Body of an address change, in the panel and in the stores. */
export function parseAddressChanges(body: unknown): AddressChanges {
	return changes(body, addressParsers);
}
