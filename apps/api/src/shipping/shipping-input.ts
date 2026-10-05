import {
	type ShippingKind,
	shippingKind,
} from "../database/schemas/shipping-methods.js";
import { Money } from "../domain/money.js";
import {
	invalid,
	isObject,
	objectBody,
	requiredText,
} from "../http/request-body.js";
import type { ShippingCalculator } from "./shipping-calculator.js";

/** The calculator of each kind of method. */
export type ShippingCalculators = Record<ShippingKind, ShippingCalculator>;

const NAME_MAX = 120;

/** Money columns are 32-bit integers of cents. */
const CENTS_MAX = 2 ** 31 - 1;
/** Longest delivery time a method may promise, in days. */
const DELIVERY_DAYS_MAX = 365;

/**
 * A method's settings as an object of the given fields only; absent or
 * empty is {}.
 */
export function configFields(
	input: unknown,
	fields: readonly string[],
): Record<string, unknown> {
	if (input === undefined) {
		return {};
	}
	if (!isObject(input)) {
		return invalid("config must be an object");
	}
	const unknown = Object.keys(input).filter((f) => !fields.includes(f));
	if (unknown.length > 0) {
		invalid(`Unknown config fields: ${unknown.join(", ")}`);
	}
	return input;
}

/** Whole cents from 0. */
export function cents(value: unknown, field: string): Money {
	const amount = Money.tryParse(value);
	return amount !== null && amount >= 0 && amount <= CENTS_MAX
		? amount
		: invalid(`${field} must be a whole number of cents, from 0`);
}

/** null, or whole days from 1 to a year. */
export function deliveryDays(value: unknown): number | null {
	return value === null ||
		(Number.isInteger(value) &&
			(value as number) >= 1 &&
			(value as number) <= DELIVERY_DAYS_MAX)
		? (value as number | null)
		: invalid(
				`config.deliveryDays must be null or a whole number from 1 to ${DELIVERY_DAYS_MAX}`,
			);
}

export interface NewShippingMethod {
	name: string;
	kind: ShippingKind;
	/** As the kind's calculator validated it. */
	config: unknown;
	enabled: boolean;
}

export interface ShippingMethodChanges {
	name?: string;
	enabled?: boolean;
	/** Not validated yet: that takes the method's kind. */
	config?: unknown;
}

const enabled = (value: unknown): boolean =>
	typeof value === "boolean"
		? value
		: invalid("enabled must be true or false");

/** Body of POST /admin/shipping-methods. */
export function parseNewShippingMethod(
	body: unknown,
	calculators: ShippingCalculators,
): NewShippingMethod {
	const fields = objectBody(body, ["name", "kind", "config", "enabled"]);
	const kinds: readonly unknown[] = shippingKind.enumValues;
	const kind = kinds.includes(fields.kind)
		? (fields.kind as ShippingKind)
		: invalid(`kind must be one of ${kinds.join(", ")}`);
	return {
		name: requiredText(fields.name, "name", NAME_MAX),
		kind,
		config: calculators[kind].parseConfig(fields.config),
		enabled: fields.enabled === undefined ? true : enabled(fields.enabled),
	};
}

/** Body of PATCH /admin/shipping-methods/:id. The kind never changes. */
export function parseShippingMethodChanges(
	body: unknown,
): ShippingMethodChanges {
	const fields = objectBody(body, ["name", "enabled", "config"]);
	const changes: ShippingMethodChanges = {};
	if ("name" in fields) {
		changes.name = requiredText(fields.name, "name", NAME_MAX);
	}
	if ("enabled" in fields) {
		changes.enabled = enabled(fields.enabled);
	}
	if ("config" in fields) {
		changes.config = fields.config;
	}
	return changes;
}
