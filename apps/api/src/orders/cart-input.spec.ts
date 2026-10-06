import { parseExpectedTotal } from "./cart-input.js";

describe("parseExpectedTotal", () => {
	it("takes a total in cents, 0 included", () => {
		expect(parseExpectedTotal({ expectedTotal: 5500 })).toBe(5500);
		expect(parseExpectedTotal({ expectedTotal: 0 })).toBe(0);
	});

	it.each([
		[undefined],
		[{}],
		[{ expectedTotal: -1 }],
		[{ expectedTotal: 1.5 }],
	])("refuses %j", (body) => {
		expect(() => parseExpectedTotal(body)).toThrow();
	});
});
