import type { Cep } from "../domain/cep.js";
import type { ProductVariantId } from "../domain/ids.js";
import type { Money } from "../domain/money.js";

/** A variant to ship, with what carriers need to price it. */
export interface ParcelItem {
	variantId: ProductVariantId;
	quantity: number;
	unitPrice: Money;
	/** In grams; null when the store has not set it. */
	weight: number | null;
	/** Sides of the package, in centimeters; null when not set. */
	height: number | null;
	width: number | null;
	length: number | null;
}

/** What a cart would ship, and where to. */
export interface Parcel {
	/** null while the buyer has given no CEP. */
	destination: Cep | null;
	subtotal: Money;
	items: ParcelItem[];
}

export interface ShippingQuote {
	price: Money;
	/** Business days to deliver; null when the method does not say. */
	deliveryDays: number | null;
}

/**
 * Prices shipping for one kind of method. Each kind is an adapter in
 * `adapters/`: a new carrier is a new calculator registered in
 * ShippingModule, and the cart never changes for it.
 */
export interface ShippingCalculator<Config = unknown> {
	/** The method's settings sent by the panel, validated; 400 when invalid. */
	parseConfig(input: unknown): Config;
	/**
	 * The price to ship the parcel, or null when the method cannot ship it.
	 * Throws when a carrier fails to answer.
	 */
	quote(config: Config, parcel: Parcel): Promise<ShippingQuote | null>;
}
