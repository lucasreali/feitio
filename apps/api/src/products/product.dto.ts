import type { ProductStatus } from "../database/schemas/products.js";

export class ProductImageDto {
	/** The asset's id. */
	id: string;
	/** Permanent public address of the image. */
	url: string;
}

export class ProductOptionDto {
	id: string;
	name: string;
}

export class ProductOptionGroupDto {
	id: string;
	name: string;
	options: ProductOptionDto[];
}

export class ProductVariantDto {
	id: string;
	sku: string;
	/** In cents: R$ 49,90 is 4990. */
	price: number;
	image: ProductImageDto | null;
	/** One option of each option group, in the groups' order. */
	optionIds: string[];
}

export class ProductFacetValueDto {
	id: string;
	name: string;
	facetId: string;
	facetName: string;
}

export class ProductDto {
	id: string;
	name: string;
	slug: string;
	/** Plain text. */
	description: string;
	status: ProductStatus;
	seoTitle: string | null;
	seoDescription: string | null;
	images: ProductImageDto[];
	optionGroups: ProductOptionGroupDto[];
	/** At least one. */
	variants: ProductVariantDto[];
	facetValues: ProductFacetValueDto[];
}

/** A product in a list. */
export class ProductCardDto {
	id: string;
	name: string;
	slug: string;
	/** Lowest price of its variants, in cents. */
	price: number;
	/** The first image. */
	image: ProductImageDto | null;
}

export class AdminProductCardDto extends ProductCardDto {
	status: ProductStatus;
}

export class AdminProductPageDto {
	items: AdminProductCardDto[];
	page: number;
	pageSize: number;
	/** Products in every page. */
	total: number;
}

export class FirstVariantDto {
	/** 1 to 64 letters, digits, dots, dashes or underscores; unique in the store. */
	sku: string;
	/** In cents, from 0. */
	price: number;
}

export class CreateProductDto {
	/** 1 to 200 characters. */
	name: string;
	/** Unique in the store. Left out, it comes from the name (with a suffix if taken). */
	slug?: string;
	/** Plain text, up to 10,000 characters. */
	description?: string;
	/** Up to 120 characters. */
	seoTitle?: string | null;
	/** Up to 320 characters. */
	seoDescription?: string | null;
	/** Every product has at least one variant; this is the first. */
	variant: FirstVariantDto;
}

/** Send only the fields to change. New products are drafts. */
export class UpdateProductDto {
	name?: string;
	slug?: string;
	description?: string | null;
	/** Only `active` products reach the stores; `archived` takes one out for good. */
	status?: ProductStatus;
	seoTitle?: string | null;
	seoDescription?: string | null;
	/** Replaces the images, in this order. */
	imageIds?: string[];
	/** Replaces the facet values. */
	facetValueIds?: string[];
}

export class CreateOptionGroupDto {
	/** 1 to 80 characters, unique in the product, such as Size. */
	name: string;
	/** At least one. The product's variants take the first one. */
	options: string[];
}

export class CreateVariantDto {
	sku: string;
	/** In cents, from 0. */
	price: number;
	/** One option of each of the product's option groups; [] when it has none. */
	optionIds: string[];
	/** An asset of the store. */
	imageId?: string | null;
}

/** Send only the fields to change. A variant's options never change. */
export class UpdateVariantDto {
	sku?: string;
	price?: number;
	/** null removes the image. */
	imageId?: string | null;
}
