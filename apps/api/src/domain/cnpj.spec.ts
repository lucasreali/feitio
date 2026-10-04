import { Cnpj } from "./cnpj.js";

describe("Cnpj", () => {
	it.each(["11222333000181", "11444777000161", "12ABC34501DE35"])(
		"accepts the valid CNPJ %j",
		(value) => {
			expect(Cnpj.parse(value)).toBe(value);
			expect(Cnpj.tryParse(value)).toBe(value);
		},
	);

	it("keeps only the characters of a formatted CNPJ, in capitals", () => {
		expect(Cnpj.parse("11.222.333/0001-81")).toBe("11222333000181");
		expect(Cnpj.tryParse(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
	});

	it.each([
		["a wrong first check digit", "11222333000171"],
		["a wrong second check digit", "11222333000182"],
		["all characters equal", "00000000000000"],
		["letters in the check digits", "12ABC34501DE3A"],
		["thirteen characters", "1122233300018"],
		["fifteen characters", "112223330001810"],
		["other symbols", "11222333#00181"],
		["empty", ""],
	])("refuses a CNPJ with %s", (_case, value) => {
		expect(() => Cnpj.parse(value)).toThrow("Invalid Cnpj");
		expect(Cnpj.tryParse(value)).toBeNull();
	});
});
