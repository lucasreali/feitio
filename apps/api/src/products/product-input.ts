import {
	type ProductStatus,
	productStatus,
} from "../database/schemas/products.js";
import { AssetId, FacetValueId, ProductOptionId } from "../domain/ids.js";
import { Money } from "../domain/money.js";
import { Sku } from "../domain/sku.js";
import { Slug, slugify } from "../domain/slug.js";
import {
	idList,
	invalid,
	isObject,
	objectBody,
	optionalText,
	requiredText,
	textList,
} from "../http/request-body.js";

const NAME_MAX = 200;
const DESCRIPTION_MAX = 10_000;
const SEO_TITLE_MAX = 120;
const SEO_DESCRIPTION_MAX = 320;
/** Longest name of an option group or option. */
export const OPTION_NAME_MAX = 80;
/** The price column is a 32-bit integer of cents. */
const PRICE_MAX = 2 ** 31 - 1;

export interface NewProduct {
	name: string;
	slug: Slug;
	/** The slug came from the name: a suffix makes it free if the store uses it. */
	slugFromName: boolean;
	description: string;
	seoTitle: string | null;
	seoDescription: string | null;
	variant: { sku: Sku; price: Money };
}

export interface ProductChanges {
	name?: string;
	slug?: Slug;
	description?: string;
	status?: ProductStatus;
	seoTitle?: string | null;
	seoDescription?: string | null;
	/** Replaces the images, in this order. */
	imageIds?: AssetId[];
	/** Replaces the facet values. */
	facetValueIds?: FacetValueId[];
}

export interface NewOptionGroup {
	name: string;
	options: string[];
}

export interface NewVariant {
	sku: Sku;
	price: Money;
	optionIds: ProductOptionId[];
	imageId: AssetId | null;
}

export interface VariantChanges {
	sku?: Sku;
	price?: Money;
	/** null removes the image. */
	imageId?: AssetId | null;
}

const sku = (value: unknown) =>
	(typeof value === "string" && Sku.tryParse(value)) ||
	invalid(
		"sku must have 1 to 64 letters, digits, dots, dashes or underscores",
	);

const price = (value: unknown): Money => {
	const cents = Money.tryParse(value);
	return cents !== null && cents >= 0 && cents <= PRICE_MAX
		? cents
		: invalid("price must be a whole number of cents, from 0");
};

const slug = (value: unknown) =>
	(typeof value === "string" && Slug.tryParse(value)) ||
	invalid(
		"slug must be lowercase letters, digits and single dashes, up to 120 characters",
	);

const imageId = (value: unknown) =>
	value === null
		? null
		: (typeof value === "string" && AssetId.tryParse(value)) ||
			invalid("imageId must be an asset id or null");

/** Body of POST /admin/products. */
export function parseNewProduct(body: unknown): NewProduct {
	const fields = objectBody(body, [
		"name",
		"slug",
		"description",
		"seoTitle",
		"seoDescription",
		"variant",
	]);
	if (!isObject(fields.variant)) {
		return invalid("variant must be an object with sku and price");
	}
	const variant = objectBody(fields.variant, ["sku", "price"]);
	const name = requiredText(fields.name, "name", NAME_MAX);
	const slugFromName = fields.slug === undefined;
	return {
		name,
		slug: slugFromName
			? (slugify(name) ??
				invalid(
					"name has no letters or digits for a slug; send a slug",
				))
			: slug(fields.slug),
		slugFromName,
		description:
			optionalText(
				fields.description ?? null,
				"description",
				DESCRIPTION_MAX,
			) ?? "",
		seoTitle: optionalText(
			fields.seoTitle ?? null,
			"seoTitle",
			SEO_TITLE_MAX,
		),
		seoDescription: optionalText(
			fields.seoDescription ?? null,
			"seoDescription",
			SEO_DESCRIPTION_MAX,
		),
		variant: { sku: sku(variant.sku), price: price(variant.price) },
	};
}

/** Body of PATCH /admin/products/:id. */
export function parseProductChanges(body: unknown): ProductChanges {
	const fields = objectBody(body, [
		"name",
		"slug",
		"description",
		"status",
		"seoTitle",
		"seoDescription",
		"imageIds",
		"facetValueIds",
	]);
	const changes: ProductChanges = {};
	if ("name" in fields) {
		changes.name = requiredText(fields.name, "name", NAME_MAX);
	}
	if ("slug" in fields) {
		changes.slug = slug(fields.slug);
	}
	if ("description" in fields) {
		changes.description =
			optionalText(fields.description, "description", DESCRIPTION_MAX) ??
			"";
	}
	if ("status" in fields) {
		const statuses: readonly unknown[] = productStatus.enumValues;
		changes.status = statuses.includes(fields.status)
			? (fields.status as ProductStatus)
			: invalid(`status must be one of ${statuses.join(", ")}`);
	}
	if ("seoTitle" in fields) {
		changes.seoTitle = optionalText(
			fields.seoTitle,
			"seoTitle",
			SEO_TITLE_MAX,
		);
	}
	if ("seoDescription" in fields) {
		changes.seoDescription = optionalText(
			fields.seoDescription,
			"seoDescription",
			SEO_DESCRIPTION_MAX,
		);
	}
	if ("imageIds" in fields) {
		changes.imageIds = idList(fields.imageIds, "imageIds", AssetId);
	}
	if ("facetValueIds" in fields) {
		changes.facetValueIds = idList(
			fields.facetValueIds,
			"facetValueIds",
			FacetValueId,
		);
	}
	return changes;
}

/** Body of POST /admin/products/:id/option-groups. */
export function parseNewOptionGroup(body: unknown): NewOptionGroup {
	const fields = objectBody(body, ["name", "options"]);
	return {
		name: requiredText(fields.name, "name", OPTION_NAME_MAX),
		options: textList(fields.options, "options", OPTION_NAME_MAX),
	};
}

/** Body of POST /admin/products/:id/variants. */
export function parseNewVariant(body: unknown): NewVariant {
	const fields = objectBody(body, ["sku", "price", "optionIds", "imageId"]);
	return {
		sku: sku(fields.sku),
		price: price(fields.price),
		optionIds: idList(fields.optionIds, "optionIds", ProductOptionId),
		imageId: imageId(fields.imageId ?? null),
	};
}

/**
 * Body of PATCH /admin/variants/:id. The options are not here on purpose: a
 * variant's combination never changes, since stock and orders point at it.
 */
export function parseVariantChanges(body: unknown): VariantChanges {
	const fields = objectBody(body, ["sku", "price", "imageId"]);
	const changes: VariantChanges = {};
	if ("sku" in fields) {
		changes.sku = sku(fields.sku);
	}
	if ("price" in fields) {
		changes.price = price(fields.price);
	}
	if ("imageId" in fields) {
		changes.imageId = imageId(fields.imageId);
	}
	return changes;
}
