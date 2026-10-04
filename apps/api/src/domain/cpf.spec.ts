import { Cpf } from "./cpf.js";

describe("Cpf", () => {
	it.each(["52998224725", "11144477735", "00000000191"])(
		"accepts the valid CPF %j",
		(value) => {
			expect(Cpf.parse(value)).toBe(value);
			expect(Cpf.tryParse(value)).toBe(value);
		},
	);

	it("keeps only the digits of a formatted CPF", () => {
		expect(Cpf.parse("529.982.247-25")).toBe("52998224725");
		expect(Cpf.tryParse(" 111.444.777-35 ")).toBe("11144477735");
	});

	it.each([
		["a wrong first check digit", "52998224735"],
		["a wrong second check digit", "52998224726"],
		["all digits equal", "11111111111"],
		["ten digits", "5299822472"],
		["twelve digits", "529982247250"],
		["letters", "5299822472a"],
		["empty", ""],
	])("refuses a CPF with %s", (_case, value) => {
		expect(() => Cpf.parse(value)).toThrow("Invalid Cpf");
		expect(Cpf.tryParse(value)).toBeNull();
	});
});
