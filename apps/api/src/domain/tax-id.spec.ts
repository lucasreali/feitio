import { TaxId } from "./tax-id.js";

describe("TaxId", () => {
	it("reads a CPF or a CNPJ", () => {
		expect(TaxId.parse("529.982.247-25")).toBe("52998224725");
		expect(TaxId.parse("11.222.333/0001-81")).toBe("11222333000181");
	});

	it.each(["52998224726", "11222333000182", "123"])("refuses %j", (value) => {
		expect(() => TaxId.parse(value)).toThrow("Invalid TaxId");
		expect(TaxId.tryParse(value)).toBeNull();
	});
});
