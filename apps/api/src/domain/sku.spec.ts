import { Sku } from "./sku.js";

describe("Sku", () => {
	it.each(["CAM-AZ-M", "tenis.42", "A_1", "a".repeat(64)])(
		"accepts %j",
		(value) => {
			expect(Sku.parse(value)).toBe(value);
		},
	);

	it.each([
		["spaces", "CAM AZ"],
		["a leading dash", "-CAM"],
		["accents", "CAMISÃO"],
		["a slash", "CAM/AZ"],
		["empty", ""],
		["more than 64 characters", "a".repeat(65)],
	])("refuses %s", (_case, value) => {
		expect(() => Sku.parse(value)).toThrow("Invalid Sku");
		expect(Sku.tryParse(value)).toBeNull();
	});
});
