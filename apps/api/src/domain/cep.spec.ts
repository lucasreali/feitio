import { Cep } from "./cep.js";

describe("Cep", () => {
	it("keeps the 8 digits", () => {
		expect(Cep.parse("01310-100")).toBe("01310100");
		expect(Cep.tryParse(" 88015600 ")).toBe("88015600");
	});

	it.each(["0131010", "013101000", "01310-10a", "00000000", ""])(
		"refuses %j",
		(value) => {
			expect(() => Cep.parse(value)).toThrow("Invalid Cep");
			expect(Cep.tryParse(value)).toBeNull();
		},
	);
});
