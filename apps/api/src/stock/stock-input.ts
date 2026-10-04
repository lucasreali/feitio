import { invalid, objectBody } from "../http/request-body.js";

/** Stock columns are 32-bit integers. */
const INT_MAX = 2 ** 31 - 1;

export interface StockPolicyChanges {
	trackStock?: boolean;
	allowBackorder?: boolean;
	/** null: never warn. */
	lowStockThreshold?: number | null;
}

const flag = (value: unknown, field: string): boolean =>
	typeof value === "boolean"
		? value
		: invalid(`${field} must be true or false`);

/** Body of PATCH /admin/variants/:id/stock. */
export function parseStockPolicyChanges(body: unknown): StockPolicyChanges {
	const fields = objectBody(body, [
		"trackStock",
		"allowBackorder",
		"lowStockThreshold",
	]);
	const changes: StockPolicyChanges = {};
	if ("trackStock" in fields) {
		changes.trackStock = flag(fields.trackStock, "trackStock");
	}
	if ("allowBackorder" in fields) {
		changes.allowBackorder = flag(fields.allowBackorder, "allowBackorder");
	}
	if ("lowStockThreshold" in fields) {
		const value = fields.lowStockThreshold;
		changes.lowStockThreshold =
			value === null ||
			(Number.isInteger(value) &&
				(value as number) >= 0 &&
				(value as number) <= INT_MAX)
				? (value as number | null)
				: invalid(
						"lowStockThreshold must be null or a whole number from 0",
					);
	}
	return changes;
}

/** Body of POST /admin/variants/:id/stock/adjustments: units to add (or remove, if negative). */
export function parseAdjustment(body: unknown): number {
	const { quantity } = objectBody(body, ["quantity"]);
	return Number.isInteger(quantity) &&
		quantity !== 0 &&
		Math.abs(quantity as number) <= INT_MAX
		? (quantity as number)
		: invalid("quantity must be a whole number other than 0");
}
