import { BrazilianState } from "./state.js";

describe("BrazilianState", () => {
	it("reads the abbreviation of a state, in capitals", () => {
		expect(BrazilianState.parse("SP")).toBe("SP");
		expect(BrazilianState.tryParse(" df ")).toBe("DF");
	});

	it.each(["XX", "S", "SPP", "São Paulo", ""])("refuses %j", (value) => {
		expect(() => BrazilianState.parse(value)).toThrow(
			"Invalid BrazilianState",
		);
		expect(BrazilianState.tryParse(value)).toBeNull();
	});
});
