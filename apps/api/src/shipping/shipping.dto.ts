import type { ShippingKind } from "../database/schemas/shipping-methods.js";

/** A way the store ships. */
export class ShippingMethodDto {
	id: string;
	/** What the buyer sees. */
	name: string;
	/** `fixed`, `melhor_envio` or `pickup`; never changes. */
	kind: ShippingKind;
	/** The kind's settings (see CreateShippingMethodDto). */
	config: Record<string, unknown>;
	/** Only enabled methods are offered to buyers. */
	enabled: boolean;
}

export class CreateShippingMethodDto {
	/** 1 to 120 characters, unique in the store. For pickup, say where and when. */
	name: string;
	kind: ShippingKind;
	/**
	 * By kind. `fixed`: `price` in cents, and optionally `freeAbove` (free
	 * shipping from this subtotal on, in cents) and `deliveryDays`.
	 * `melhor_envio`: `serviceId` (Melhor Envio's id of the carrier's
	 * service, such as 1 for Correios PAC and 2 for Sedex) and `originCep`,
	 * where parcels leave from; variants need weight and dimensions.
	 * `pickup`: none (free, and the order needs no shipping address).
	 */
	config?: Record<string, unknown>;
	/** true by default. */
	enabled?: boolean;
}

/** Send only the fields to change. */
export class UpdateShippingMethodDto {
	name?: string;
	enabled?: boolean;
	/** Replaces the settings, checked against the method's kind. */
	config?: Record<string, unknown>;
}

/** A method that can ship the cart, priced for it. Amounts in cents. */
export class ShippingOptionDto {
	/** The method's id, to choose it. */
	id: string;
	name: string;
	kind: ShippingKind;
	price: number;
	/** Business days to deliver; null when the method does not say. */
	deliveryDays: number | null;
}
