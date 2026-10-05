import {
	BadGatewayException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
} from "@nestjs/common";
import type { ShippingMethodId } from "../domain/ids.js";
import { invalid } from "../http/request-body.js";
import type { ShippingOptionDto } from "./shipping.dto.js";
import type { Parcel, ShippingQuote } from "./shipping-calculator.js";
import type { ShippingCalculators } from "./shipping-input.js";
import {
	SHIPPING_CALCULATORS,
	ShippingMethodsRepository,
} from "./shipping-methods.repository.js";

const logger = new Logger("Shipping");

/** A method the buyer chose, priced for the parcel. */
export interface ShippingChoice extends ShippingQuote {
	methodId: ShippingMethodId;
	name: string;
}

/**
 * Prices a parcel with the store's enabled methods. Carriers are called
 * here, outside any database transaction.
 */
@Injectable()
export class ShippingQuotes {
	constructor(
		private readonly methods: ShippingMethodsRepository,
		@Inject(SHIPPING_CALCULATORS)
		private readonly calculators: ShippingCalculators,
	) {}

	/**
	 * Every enabled method that can ship the parcel, cheapest first. A
	 * carrier that fails is logged and left out, so the others still show.
	 */
	async options(parcel: Parcel): Promise<ShippingOptionDto[]> {
		const methods = await this.methods.enabled();
		const quoted = await Promise.all(
			methods.map(async ({ id, name, kind, config }) => {
				try {
					const quote = await this.calculators[kind].quote(
						config,
						parcel,
					);
					return quote && { id, name, kind, ...quote };
				} catch (error) {
					logger.error(
						`Quote of ${kind} method ${id} failed: ${error}`,
					);
					return null;
				}
			}),
		);
		return quoted
			.filter((option) => option !== null)
			.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
	}

	/**
	 * The method priced for the parcel. 400 for a method the store does not
	 * offer, 409 when it cannot ship the parcel, 502 when its carrier fails.
	 */
	async quote(
		methodId: ShippingMethodId,
		parcel: Parcel,
	): Promise<ShippingChoice> {
		const method =
			(await this.methods.enabled()).find((m) => m.id === methodId) ??
			invalid("methodId is not a shipping method the store offers");
		let quote: ShippingQuote | null;
		try {
			quote = await this.calculators[method.kind].quote(
				method.config,
				parcel,
			);
		} catch (error) {
			logger.error(
				`Quote of ${method.kind} method ${method.id} failed: ${error}`,
			);
			throw new BadGatewayException(
				"The carrier did not answer; try again",
			);
		}
		if (!quote) {
			throw new ConflictException("This method cannot ship the cart");
		}
		return { methodId, name: method.name, ...quote };
	}
}
