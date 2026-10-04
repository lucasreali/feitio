import { BadRequestException } from "@nestjs/common";
import { CollectionId, FacetValueId, ProductId } from "../domain/ids.js";
import {
	parseCollectionChanges,
	parseCollectionOrder,
	parseCollectionProducts,
	parseNewCollection,
} from "./collection-input.js";

const parent = CollectionId.generate();
const value = FacetValueId.generate();

describe("parseNewCollection", () => {
	it("reads a manual collection, with the slug from the name", () => {
		expect(
			parseNewCollection({ name: "Calçados", kind: "manual" }),
		).toEqual({
			name: "Calçados",
			slug: "calcados",
			slugFromName: true,
			description: "",
			kind: "manual",
			parentId: null,
			seoTitle: null,
			seoDescription: null,
			facetValueIds: [],
		});
	});

	it("reads a rule collection under a parent", () => {
		expect(
			parseNewCollection({
				name: "Aurora",
				slug: "marca-aurora",
				kind: "rule",
				parentId: parent,
				facetValueIds: [value],
			}),
		).toMatchObject({
			slug: "marca-aurora",
			slugFromName: false,
			kind: "rule",
			parentId: parent,
			facetValueIds: [value],
		});
	});

	it.each([
		["no kind", { name: "x" }],
		["an unknown kind", { name: "x", kind: "smart" }],
		["a rule without facet values", { name: "x", kind: "rule" }],
		[
			"a rule with no facet values",
			{ name: "x", kind: "rule", facetValueIds: [] },
		],
		[
			"facet values in a manual collection",
			{ name: "x", kind: "manual", facetValueIds: [value] },
		],
		["an invalid parent", { name: "x", kind: "manual", parentId: "x" }],
	])("refuses %s", (_case, body) => {
		expect(() => parseNewCollection(body)).toThrow(BadRequestException);
	});
});

describe("parseCollectionChanges", () => {
	it("keeps only the fields sent; a null parent moves it to the top", () => {
		expect(
			parseCollectionChanges({ parentId: null, seoTitle: "T" }),
		).toEqual({
			parentId: null,
			seoTitle: "T",
		});
	});

	it.each([{}, { kind: "rule" }, { facetValueIds: [] }, { slug: null }])(
		"refuses %j",
		(body) => {
			expect(() => parseCollectionChanges(body)).toThrow(
				BadRequestException,
			);
		},
	);
});

describe("parseCollectionOrder", () => {
	it("reads the parent and the ids in their new order", () => {
		const ids = [CollectionId.generate(), CollectionId.generate()];
		expect(
			parseCollectionOrder({ parentId: null, collectionIds: ids }),
		).toEqual({
			parentId: null,
			collectionIds: ids,
		});
	});

	it.each([{ collectionIds: [] }, { parentId: null }])(
		"refuses %j",
		(body) => {
			expect(() => parseCollectionOrder(body)).toThrow(
				BadRequestException,
			);
		},
	);
});

describe("parseCollectionProducts", () => {
	it("reads the products in order", () => {
		const ids = [ProductId.generate()];
		expect(parseCollectionProducts({ productIds: ids })).toEqual(ids);
		expect(parseCollectionProducts({ productIds: [] })).toEqual([]);
	});

	it.each([{}, { productIds: "x" }])("refuses %j", (body) => {
		expect(() => parseCollectionProducts(body)).toThrow(
			BadRequestException,
		);
	});
});
