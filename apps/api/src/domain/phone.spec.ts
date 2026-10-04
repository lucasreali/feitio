import { Phone } from "./phone.js";

describe("Phone", () => {
	it.each([
		["(11) 98765-4321", "+5511987654321"],
		["11987654321", "+5511987654321"],
		["+55 11 98765-4321", "+5511987654321"],
		["5511987654321", "+5511987654321"],
		["(21) 3456-7890", "+552134567890"],
		["+55 (48) 2345-6789", "+554823456789"],
		// 55 is also an area code (Santa Maria, RS).
		["(55) 98765-4321", "+5555987654321"],
	])("reads %j as %j", (value, expected) => {
		expect(Phone.parse(value)).toBe(expected);
		expect(Phone.tryParse(value)).toBe(expected);
	});

	it.each([
		["a mobile number without the 9", "(11) 8765-4321"],
		["eleven digits not starting with 9", "11887654321"],
		["an area code with 0", "(01) 98765-4321"],
		["a landline starting with 1", "(11) 1234-5678"],
		["another country", "+1 202 555 0100"],
		["letters", "11 9876S-4321"],
		["too short", "98765-4321"],
		["empty", ""],
	])("refuses %s", (_case, value) => {
		expect(() => Phone.parse(value)).toThrow("Invalid Phone");
		expect(Phone.tryParse(value)).toBeNull();
	});
});
