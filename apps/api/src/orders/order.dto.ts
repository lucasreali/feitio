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

/** A cart, or the order it became. Amounts in cents. */
export class CartDto {
	/**
	 * `cart`, `awaiting_payment`, `paid`, `preparing`, `shipped`,
	 * `delivered` or `cancelled`. Only a cart can be changed.
	 */
	state: OrderState;
	/** Given when the order is placed. */
	number: number | null;
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

export class AddLineDto {
	variantId: string;
	/** 1 to 999, added to the units the cart already has of the variant. */
	quantity: number;
}

export class LineQuantityDto {
	/** 1 to 999. */
	quantity: number;
}
