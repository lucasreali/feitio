import type { Brand } from "./brand.js";

/**
 * An amount in Brazilian reais, as an integer number of cents (R$ 12,90 is
 * 1290). Never a loose number: prices, totals and discounts are Money.
 * Operations (sums, quantities, discounts) are added here when the first
 * caller needs them.
 */
export type Money = Brand<number, "Money">;

const isValid = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value);

export const Money = {
	parse(cents: unknown): Money {
		if (!isValid(cents)) {
			throw new Error(`Invalid Money: ${JSON.stringify(cents)}`);
		}
		return cents as Money;
	},
	tryParse(cents: unknown): Money | null {
		return isValid(cents) ? (cents as Money) : null;
	},
};
