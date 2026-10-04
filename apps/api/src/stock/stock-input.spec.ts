import { BadRequestException } from "@nestjs/common";
import { parseAdjustment, parseStockPolicyChanges } from "./stock-input.js";

describe("parseStockPolicyChanges", () => {
	it("reads only the fields sent", () => {
		expect(parseStockPolicyChanges({ trackStock: false })).toEqual({
			trackStock: false,
		});
		expect(
			parseStockPolicyChanges({
				trackStock: true,
				allowBackorder: true,
				lowStockThreshold: 3,
			}),
		).toEqual({
			trackStock: true,
			allowBackorder: true,
			lowStockThreshold: 3,
		});
		expect(parseStockPolicyChanges({ lowStockThreshold: null })).toEqual({
			lowStockThreshold: null,
		});
	});

	it.each([
		["no field", {}],
		["an unknown field", { available: 3 }],
		["trackStock as text", { trackStock: "true" }],
		["allowBackorder as a number", { allowBackorder: 1 }],
		["a negative threshold", { lowStockThreshold: -1 }],
		["a fractional threshold", { lowStockThreshold: 1.5 }],
		["a threshold too large to store", { lowStockThreshold: 2 ** 31 }],
	])("refuses %s", (_case, body) => {
		expect(() => parseStockPolicyChanges(body)).toThrow(
			BadRequestException,
		);
	});
});

describe("parseAdjustment", () => {
	it("reads units to add or remove", () => {
		expect(parseAdjustment({ quantity: 5 })).toBe(5);
		expect(parseAdjustment({ quantity: -2 })).toBe(-2);
	});

	it.each([
		["no quantity", {}],
		["zero", { quantity: 0 }],
		["a fraction", { quantity: 1.5 }],
		["text", { quantity: "3" }],
		["a quantity too large to store", { quantity: 2 ** 31 }],
		["an unknown field", { quantity: 1, reason: "count" }],
	])("refuses %s", (_case, body) => {
		expect(() => parseAdjustment(body)).toThrow(BadRequestException);
	});
});
