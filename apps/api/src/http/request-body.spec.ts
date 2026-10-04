import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ProductId } from "../domain/ids.js";
import {
	idList,
	nameBody,
	objectBody,
	optionalText,
	pathId,
	requiredText,
	textList,
} from "./request-body.js";

const id = ProductId.generate();

describe("objectBody", () => {
	it("returns an object with known fields", () => {
		expect(objectBody({ name: "x" }, ["name", "slug"])).toEqual({
			name: "x",
		});
	});

	it.each([
		["no body", undefined],
		["an array", []],
		["an empty object", {}],
		["an unknown field", { name: "x", other: 1 }],
	])("refuses %s", (_case, body) => {
		expect(() => objectBody(body, ["name"])).toThrow(BadRequestException);
	});
});

describe("requiredText", () => {
	it("trims", () => {
		expect(requiredText("  Camiseta ", "name", 10)).toBe("Camiseta");
	});

	it.each([undefined, null, 1, "", "   ", "a".repeat(11)])(
		"refuses %j",
		(value) => {
			expect(() => requiredText(value, "name", 10)).toThrow(
				BadRequestException,
			);
		},
	);
});

describe("optionalText", () => {
	it("trims, and turns null and blank text into null", () => {
		expect(optionalText(" Título ", "seoTitle", 10)).toBe("Título");
		expect(optionalText(null, "seoTitle", 10)).toBeNull();
		expect(optionalText("  ", "seoTitle", 10)).toBeNull();
	});

	it.each([1, "a".repeat(11)])("refuses %j", (value) => {
		expect(() => optionalText(value, "seoTitle", 10)).toThrow(
			BadRequestException,
		);
	});
});

describe("textList", () => {
	it("trims each name", () => {
		expect(textList([" P", "M "], "options", 10)).toEqual(["P", "M"]);
	});

	it.each([[[]], ["P"], [["P", " P"]], [["P", ""]], [[1]]])(
		"refuses %j",
		(value) => {
			expect(() => textList(value, "options", 10)).toThrow(
				BadRequestException,
			);
		},
	);
});

describe("idList", () => {
	it("parses distinct ids, keeping their order", () => {
		const other = ProductId.generate();
		expect(idList([other, id], "productIds", ProductId)).toEqual([
			other,
			id,
		]);
		expect(idList([], "productIds", ProductId)).toEqual([]);
	});

	it.each([[id], [["x"]], [[id, id]], [[1]]])("refuses %j", (value) => {
		expect(() => idList(value, "productIds", ProductId)).toThrow(
			BadRequestException,
		);
	});
});

describe("pathId", () => {
	it("parses an id from the path", () => {
		expect(pathId(id, ProductId)).toBe(id);
	});

	it("answers 404 to anything else, as to an unknown id", () => {
		expect(() => pathId("x", ProductId)).toThrow(NotFoundException);
	});
});

describe("nameBody", () => {
	it("reads a body with only a name", () => {
		expect(nameBody({ name: " Cor " }, 10)).toBe("Cor");
	});

	it.each([{}, { name: "" }, { name: "x", other: 1 }])(
		"refuses %j",
		(body) => {
			expect(() => nameBody(body, 10)).toThrow(BadRequestException);
		},
	);
});
