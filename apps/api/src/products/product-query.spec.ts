import { BadRequestException } from "@nestjs/common";
import { FacetValueId } from "../domain/ids.js";
import { parseStoreProductQuery } from "./product-query.js";

const [blue, red] = [FacetValueId.generate(), FacetValueId.generate()];

describe("parseStoreProductQuery", () => {
	it("defaults to every product, first page, no sort chosen", () => {
		expect(parseStoreProductQuery({})).toEqual({
			collection: null,
			facetValueIds: [],
			sort: null,
			page: { page: 1, pageSize: 24, offset: 0 },
		});
	});

	it("reads the collection, the facet values and the sort", () => {
		expect(
			parseStoreProductQuery({
				collection: "camisetas",
				facetValueIds: `${blue},${red}`,
				sort: "price-asc",
				page: "2",
			}),
		).toMatchObject({
			collection: "camisetas",
			facetValueIds: [blue, red],
			sort: "price-asc",
			page: { page: 2 },
		});
	});

	it.each([
		["an unknown sort", { sort: "random" }],
		["position without a collection", { sort: "position" }],
		["an invalid facet value id", { facetValueIds: "x" }],
		["repeated facet values", { facetValueIds: `${blue},${blue}` }],
		["an invalid collection slug", { collection: "Não" }],
		["a repeated parameter", { sort: ["name", "newest"] }],
	])("refuses %s", (_case, query) => {
		expect(() => parseStoreProductQuery(query)).toThrow(
			BadRequestException,
		);
	});
});
