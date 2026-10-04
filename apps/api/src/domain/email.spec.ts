import { Email } from "./email.js";

describe("Email", () => {
	it.each(["ana@loja.com.br", "a.b+c@sub.example.com"])(
		"accepts %j",
		(value) => {
			expect(Email.parse(value)).toBe(value);
			expect(Email.tryParse(value)).toBe(value);
		},
	);

	it("trims and lowercases, so one address has one spelling", () => {
		expect(Email.parse("  Ana@Loja.COM.br ")).toBe("ana@loja.com.br");
		expect(Email.tryParse("Ana@Loja.com")).toBe("ana@loja.com");
	});

	it.each([
		["no at sign", "ana.loja.com"],
		["no domain dot", "ana@loja"],
		["two at signs", "ana@@loja.com"],
		["spaces inside", "ana maria@loja.com"],
		["empty", ""],
		["longer than 254 characters", `${"a".repeat(250)}@x.com`],
	])("refuses an address with %s", (_case, value) => {
		expect(() => Email.parse(value)).toThrow("Invalid Email");
		expect(Email.tryParse(value)).toBeNull();
	});
});
