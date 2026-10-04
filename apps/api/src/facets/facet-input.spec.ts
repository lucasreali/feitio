import { BadRequestException } from "@nestjs/common";
import { parseNewFacet } from "./facet-input.js";

describe("parseNewFacet", () => {
	it("takes a name and optional values", () => {
		expect(
			parseNewFacet({ name: " Marca ", values: ["Aurora", " Brisa"] }),
		).toEqual({
			name: "Marca",
			values: ["Aurora", "Brisa"],
		});
		expect(parseNewFacet({ name: "Material" })).toEqual({
			name: "Material",
			values: [],
		});
	});

	it.each([
		["no name", { values: ["A"] }],
		["values that are not a list", { name: "x", values: "A" }],
		["repeated values", { name: "x", values: ["A", "A"] }],
		["an unknown field", { name: "x", code: "x" }],
	])("refuses %s", (_case, body) => {
		expect(() => parseNewFacet(body)).toThrow(BadRequestException);
	});
});
