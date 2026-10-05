import { Injectable } from "@nestjs/common";
import { Money } from "../../domain/money.js";
import type {
	Parcel,
	ShippingCalculator,
	ShippingQuote,
} from "../shipping-calculator.js";
import { cents, configFields, deliveryDays } from "../shipping-input.js";

export interface FixedRateConfig {
	price: Money;
	/** From this subtotal on, shipping is free; null: never. */
	freeAbove: Money | null;
	deliveryDays: number | null;
}

/** One price anywhere in Brazil, free from a subtotal on when the store wants. */
@Injectable()
export class FixedRateShipping implements ShippingCalculator<FixedRateConfig> {
	parseConfig(input: unknown): FixedRateConfig {
		const fields = configFields(input, [
			"price",
			"freeAbove",
			"deliveryDays",
		]);
		return {
			price: cents(fields.price, "config.price"),
			freeAbove:
				fields.freeAbove == null
					? null
					: cents(fields.freeAbove, "config.freeAbove"),
			deliveryDays: deliveryDays(fields.deliveryDays ?? null),
		};
	}

	async quote(
		config: FixedRateConfig,
		parcel: Parcel,
	): Promise<ShippingQuote> {
		const free =
			config.freeAbove !== null && parcel.subtotal >= config.freeAbove;
		return {
			price: free ? Money.parse(0) : config.price,
			deliveryDays: config.deliveryDays,
		};
	}
}
