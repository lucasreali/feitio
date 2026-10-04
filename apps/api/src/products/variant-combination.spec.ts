import { BadRequestException } from "@nestjs/common";
import { ProductOptionGroupId, ProductOptionId } from "../domain/ids.js";
import { combinationOf, sameCombination } from "./variant-combination.js";

const size = ProductOptionGroupId.generate();
const color = ProductOptionGroupId.generate();
const [small, medium, blue, red] = Array.from({ length: 4 }, () =>
	ProductOptionId.generate(),
);
const groups = [
	{ id: size, optionIds: [small, medium] },
	{ id: color, optionIds: [blue, red] },
];

describe("combinationOf", () => {
	it("pairs each option with its group, in the groups' order", () => {
		expect(combinationOf(groups, [red, small])).toEqual([
			{ groupId: size, optionId: small },
			{ groupId: color, optionId: red },
		]);
	});

	it("is empty for a product without options", () => {
		expect(combinationOf([], [])).toEqual([]);
	});

	it.each([
		["a missing group", [small]],
		["two options of one group", [small, medium, blue]],
		["an option of another product", [small, ProductOptionId.generate()]],
		["no options", []],
	])("refuses %s", (_case, optionIds) => {
		expect(() => combinationOf(groups, optionIds)).toThrow(
			BadRequestException,
		);
	});
});

describe("sameCombination", () => {
	it("ignores the order of the options", () => {
		expect(sameCombination([small, blue], [blue, small])).toBe(true);
		expect(sameCombination([small, blue], [small, red])).toBe(false);
		expect(sameCombination([], [])).toBe(true);
	});
});
