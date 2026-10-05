import type { OrderState } from "./order-state.js";

export class OrderLineDto {
	id: string;
	/** null once the variant is removed from the catalog. */
	variantId: string | null;
	productName: string;
	sku: string;
	quantity: number;
	/** In cents, from the catalog. */
	unitPrice: number;
	/** unitPrice × quantity, in cents. */
	total: number;
}

/** An address as the order keeps it: a copy, not a link to the address book. */
export class OrderAddressDto {
	/** Who receives the parcel. */
	recipient: string;
	/** E.164, such as +5511987654321. */
	phone: string | null;
	/** 8 digits. */
	cep: string;
	street: string;
	number: string;
	complement: string | null;
	neighborhood: string;
	city: string;
	/** Two-letter abbreviation, such as SP. */
	state: string;
}

export class CartCustomerDto {
	email: string;
}

/** A cart, or the order it became. Amounts in cents. */
export class CartDto {
	/**
	 * `cart`, `awaiting_payment`, `paid`, `preparing`, `shipped`,
	 * `delivered` or `cancelled`. Only a cart can be changed.
	 */
	state: OrderState;
	/** Given when the order is placed. */
	number: number | null;
	/** Who buys; only the e-mail is shown. */
	customer: CartCustomerDto | null;
	shippingAddress: OrderAddressDto | null;
	billingAddress: OrderAddressDto | null;
	/** In the order they were added. */
	lines: OrderLineDto[];
	subtotal: number;
	discount: number;
	shipping: number;
	/** subtotal − discount + shipping. */
	total: number;
}

export class NewCartDto {
	/**
	 * Send it as `X-Cart-Token` with X-Tenant. Shown only now: keep it on the
	 * store's server, like the buyer's token.
	 */
	token: string;
	cart: CartDto;
}

export class CartGuestDto {
	email: string;
	/** 1 to 120 characters. */
	name: string;
	phone?: string | null;
	/** CPF or CNPJ, with or without formatting. */
	taxId?: string | null;
}

export class SetOrderAddressDto {
	/** 1 to 120 characters. */
	recipient: string;
	phone?: string | null;
	/** 8 digits, with or without the hyphen. */
	cep: string;
	street: string;
	/** Text, for "s/n" or "123A". */
	number: string;
	complement?: string | null;
	neighborhood: string;
	city: string;
	/** Two-letter abbreviation, such as SP. */
	state: string;
}

export class AddLineDto {
	variantId: string;
	/** 1 to 999, added to the units the cart already has of the variant. */
	quantity: number;
}

export class LineQuantityDto {
	/** 1 to 999. */
	quantity: number;
}
