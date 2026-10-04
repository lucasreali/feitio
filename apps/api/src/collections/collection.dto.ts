import type { CollectionKind } from "../database/schemas/collections.js";

/** A collection in the panel's list. */
export class CollectionSummaryDto {
	id: string;
	name: string;
	slug: string;
	kind: CollectionKind;
	/** null for a top-level collection. */
	parentId: string | null;
	/** Order among the collections with the same parent. */
	position: number;
}

export class CollectionDto extends CollectionSummaryDto {
	/** Plain text. */
	description: string;
	seoTitle: string | null;
	seoDescription: string | null;
	/** A manual collection's products, in order; empty for a rule collection. */
	productIds: string[];
	/** A rule collection's facet values (its products have all of them); empty for a manual one. */
	facetValueIds: string[];
}

/** A collection in the store's navigation. */
export class StoreCollectionDto {
	id: string;
	name: string;
	slug: string;
	parentId: string | null;
	position: number;
}

/** A collection's page in the store. */
export class StoreCollectionDetailDto {
	id: string;
	name: string;
	slug: string;
	description: string;
	parentId: string | null;
	seoTitle: string | null;
	seoDescription: string | null;
}

export class CreateCollectionDto {
	/** 1 to 120 characters. */
	name: string;
	/** Unique in the store. Left out, it comes from the name (with a suffix if taken). */
	slug?: string;
	/** Plain text, up to 10,000 characters. */
	description?: string | null;
	/** `manual`: products picked in order. `rule`: products with all the facet values. Never changes. */
	kind: CollectionKind;
	/** Left out or null: top level. It goes after its new siblings. */
	parentId?: string | null;
	/** Up to 120 characters. */
	seoTitle?: string | null;
	/** Up to 320 characters. */
	seoDescription?: string | null;
	/** Required, with at least one value, for rule collections only. */
	facetValueIds?: string[];
}

/** Send only the fields to change. */
export class UpdateCollectionDto {
	name?: string;
	slug?: string;
	description?: string | null;
	/** Moves it after the children of the new parent; null moves it to the top level. */
	parentId?: string | null;
	seoTitle?: string | null;
	seoDescription?: string | null;
	/** Replaces the rule of a rule collection. */
	facetValueIds?: string[];
}

export class CollectionOrderDto {
	/** null for the top level. */
	parentId: string | null;
	/** Every collection under the parent, in the new order. */
	collectionIds: string[];
}

export class CollectionProductsDto {
	/** Replaces the products of a manual collection, in this order. */
	productIds: string[];
}
