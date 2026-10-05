import { BadRequestException } from "@nestjs/common";
import { AssetId, FacetValueId, ProductOptionId } from "../domain/ids.js";
import {
	parseNewOptionGroup,
	parseNewProduct,
	parseNewVariant,
	parseProductChanges,
	parseVariantChanges,
} from "./product-input.js";

const asset = AssetId.generate();

describe("parseNewProduct", () => {
	it("reads a product with its first variant; slug and texts are optional", () => {
		expect(
			parseNewProduct({
				name: " Camiseta ",
				variant: { sku: "CAM-1", price: 4990 },
			}),
		).toEqual({
			name: "Camiseta",
			slug: "camiseta",
			slugFromName: true,
			description: "",
			seoTitle: null,
			seoDescription: null,
			variant: { sku: "CAM-1", price: 4990 },
		});
		expect(
			parseNewProduct({
				name: "Camiseta",
				slug: "camiseta-azul",
				description: " Algodão. ",
				seoTitle: "Camiseta",
				seoDescription: "Azul",
				variant: { sku: "CAM-1", price: 0 },
			}),
		).toMatchObject({
			slug: "camiseta-azul",
			slugFromName: false,
			description: "Algodão.",
			seoTitle: "Camiseta",
			seoDescription: "Azul",
		});
	});

	it.each([
		["no variant", { name: "x" }],
		["a variant that is not an object", { name: "x", variant: "A" }],
		["a negative price", { name: "x", variant: { sku: "A", price: -1 } }],
		[
			"a fraction of a cent",
			{ name: "x", variant: { sku: "A", price: 1.5 } },
		],
		[
			"a price too large to store",
			{ name: "x", variant: { sku: "A", price: 2 ** 31 } },
		],
		["a price as text", { name: "x", variant: { sku: "A", price: "10" } }],
		["an invalid SKU", { name: "x", variant: { sku: "A B", price: 1 } }],
		[
			"an unknown variant field",
			{ name: "x", variant: { sku: "A", price: 1, stock: 1 } },
		],
		[
			"an invalid slug",
			{ name: "x", slug: "A B", variant: { sku: "A", price: 1 } },
		],
		[
			"a status",
			{ name: "x", status: "active", variant: { sku: "A", price: 1 } },
		],
		[
			"a name of symbols only, with no slug",
			{ name: "!!!", variant: { sku: "A", price: 1 } },
		],
		[
			"an SEO title over 120 characters",
			{
				name: "x",
				seoTitle: "a".repeat(121),
				variant: { sku: "A", price: 1 },
			},
		],
	])("refuses %s", (_case, body) => {
		expect(() => parseNewProduct(body)).toThrow(BadRequestException);
	});
});

describe("parseProductChanges", () => {
	it("keeps only the fields sent", () => {
		const value = FacetValueId.generate();
		expect(
			parseProductChanges({
				status: "archived",
				seoTitle: null,
				imageIds: [asset],
				facetValueIds: [value],
			}),
		).toEqual({
			status: "archived",
			seoTitle: null,
			imageIds: [asset],
			facetValueIds: [value],
		});
		expect(parseProductChanges({ description: null })).toEqual({
			description: "",
		});
	});

	it.each([
		["nothing", {}],
		["an unknown status", { status: "deleted" }],
		["a null name", { name: null }],
		["a null slug", { slug: null }],
		["repeated images", { imageIds: [asset, asset] }],
		["an unknown field", { variants: [] }],
	])("refuses %s", (_case, body) => {
		expect(() => parseProductChanges(body)).toThrow(BadRequestException);
	});
});

describe("parseNewOptionGroup", () => {
	it("reads a name and at least one option", () => {
		expect(
			parseNewOptionGroup({ name: "Tamanho", options: ["P", "M"] }),
		).toEqual({
			name: "Tamanho",
			options: ["P", "M"],
		});
	});

	it.each([{ name: "Tamanho" }, { name: "Tamanho", options: [] }])(
		"refuses %j",
		(body) => {
			expect(() => parseNewOptionGroup(body)).toThrow(
				BadRequestException,
			);
		},
	);
});

describe("parseNewVariant", () => {
	it("reads the SKU, price, options and an optional image", () => {
		const option = ProductOptionId.generate();
		expect(
			parseNewVariant({ sku: "A", price: 10, optionIds: [option] }),
		).toEqual({
			sku: "A",
			price: 10,
			optionIds: [option],
			imageId: null,
		});
		expect(
			parseNewVariant({
				sku: "A",
				price: 10,
				optionIds: [],
				imageId: asset,
			}).imageId,
		).toBe(asset);
	});

	it.each([
		{ sku: "A", price: 10 },
		{ sku: "A", optionIds: [] },
		{ sku: "A", price: 10, optionIds: [], imageId: "x" },
	])("refuses %j", (body) => {
		expect(() => parseNewVariant(body)).toThrow(BadRequestException);
	});
});

describe("parseVariantChanges", () => {
	it("keeps only the fields sent; null removes the image", () => {
		expect(parseVariantChanges({ price: 0, imageId: null })).toEqual({
			price: 0,
			imageId: null,
		});
	});

	it("reads the weight in grams and the dimensions in centimeters; null clears them", () => {
		expect(
			parseVariantChanges({
				weight: 350,
				height: 4,
				width: 30,
				length: null,
			}),
		).toEqual({ weight: 350, height: 4, width: 30, length: null });
	});

	it.each([
		{},
		{ optionIds: [] },
		{ sku: null },
		{ price: null },
		{ weight: 0 },
		{ weight: 1.5 },
		{ weight: "350" },
		{ weight: 1_000_001 },
		{ height: -1 },
		{ width: 1001 },
		{ length: 0 },
	])("refuses %j", (body) => {
		expect(() => parseVariantChanges(body)).toThrow(BadRequestException);
	});
});
