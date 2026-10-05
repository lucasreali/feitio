import { Injectable } from "@nestjs/common";
import { Money } from "../../domain/money.js";
import type {
	Parcel,
	ShippingCalculator,
	ShippingQuote,
} from "../shipping-calculator.js";
import { configFields } from "../shipping-input.js";

/**
 * The buyer picks the order up at the store: free, and the order needs no
 * shipping address. Where and when to pick up go in the method's name.
 */
@Injectable()
export class StorePickupShipping implements ShippingCalculator<object> {
	parseConfig(input: unknown): object {
		configFields(input, []);
		return {};
	}

	async quote(_config: object, _parcel: Parcel): Promise<ShippingQuote> {
		return { price: Money.parse(0), deliveryDays: null };
	}
}
