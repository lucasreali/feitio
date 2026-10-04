import { BadRequestException } from "@nestjs/common";
import { parsePage } from "./page.js";

describe("parsePage", () => {
	it("defaults to the first page of 24", () => {
		expect(parsePage({})).toEqual({ page: 1, pageSize: 24, offset: 0 });
	});

	it("reads page and pageSize from the query string", () => {
		expect(parsePage({ page: "3", pageSize: "10" })).toEqual({
			page: 3,
			pageSize: 10,
			offset: 20,
		});
	});

	it.each([
		{ page: "0" },
		{ page: "1.5" },
		{ page: "x" },
		{ pageSize: "0" },
		{ pageSize: "101" },
		{ page: ["1", "2"] },
	])("refuses %j", (query) => {
		expect(() => parsePage(query)).toThrow(BadRequestException);
	});
});
