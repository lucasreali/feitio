import { Money } from "./money.js";

describe("Money", () => {
	it.each([0, 1290, -500, Number.MAX_SAFE_INTEGER])(
		"keeps %j cents as the same number",
		(cents) => {
			expect(Money.parse(cents)).toBe(cents);
			expect(Money.tryParse(cents)).toBe(cents);
		},
	);

	it.each([
		["a fraction of a cent", 12.9],
		["NaN", Number.NaN],
		["infinity", Number.POSITIVE_INFINITY],
		["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
		["text", "1290"],
	])("refuses %s", (_case, value) => {
		expect(() => Money.parse(value)).toThrow("Invalid Money");
		expect(Money.tryParse(value)).toBeNull();
	});
});
