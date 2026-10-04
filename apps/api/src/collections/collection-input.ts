import {
	DESCRIPTION_MAX,
	newSlug,
	SEO_DESCRIPTION_MAX,
	SEO_TITLE_MAX,
	slugField,
} from "../catalog/fields.js";
import {
	type CollectionKind,
	collectionKind,
} from "../database/schemas/collections.js";
import { CollectionId, FacetValueId, ProductId } from "../domain/ids.js";
import type { Slug } from "../domain/slug.js";
import {
	idList,
	invalid,
	objectBody,
	optionalText,
	requiredText,
} from "../http/request-body.js";

const NAME_MAX = 120;

export interface NewCollection {
	name: string;
	slug: Slug;
	slugFromName: boolean;
	description: string;
	kind: CollectionKind;
	/** null for a top-level collection. */
	parentId: CollectionId | null;
	seoTitle: string | null;
	seoDescription: string | null;
	/** The rule of a rule collection; empty for a manual one. */
	facetValueIds: FacetValueId[];
}

export interface CollectionChanges {
	name?: string;
	slug?: Slug;
	description?: string;
	/** null moves it to the top level. */
	parentId?: CollectionId | null;
	seoTitle?: string | null;
	seoDescription?: string | null;
	/** Replaces the rule; only for rule collections. */
	facetValueIds?: FacetValueId[];
}

const parentId = (value: unknown) =>
	value === null
		? null
		: (typeof value === "string" && CollectionId.tryParse(value)) ||
			invalid("parentId must be a collection id or null");

const rule = (value: unknown) => {
	const ids = idList(value, "facetValueIds", FacetValueId);
	return ids.length > 0
		? ids
		: invalid("facetValueIds needs at least one facet value");
};

/** Body of POST /admin/collections. */
export function parseNewCollection(body: unknown): NewCollection {
	const fields = objectBody(body, [
		"name",
		"slug",
		"description",
		"kind",
		"parentId",
		"seoTitle",
		"seoDescription",
		"facetValueIds",
	]);
	const kinds: readonly unknown[] = collectionKind.enumValues;
	if (!kinds.includes(fields.kind)) {
		invalid(`kind must be one of ${kinds.join(", ")}`);
	}
	const kind = fields.kind as CollectionKind;
	if (kind === "manual" && fields.facetValueIds !== undefined) {
		invalid(
			"Manual collections have no facet values; set their products instead",
		);
	}
	const name = requiredText(fields.name, "name", NAME_MAX);
	return {
		name,
		...newSlug(name, fields.slug),
		description:
			optionalText(
				fields.description ?? null,
				"description",
				DESCRIPTION_MAX,
			) ?? "",
		kind,
		parentId: parentId(fields.parentId ?? null),
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
		facetValueIds: kind === "rule" ? rule(fields.facetValueIds) : [],
	};
}

/** Body of PATCH /admin/collections/:id. The kind never changes. */
export function parseCollectionChanges(body: unknown): CollectionChanges {
	const fields = objectBody(body, [
		"name",
		"slug",
		"description",
		"parentId",
		"seoTitle",
		"seoDescription",
		"facetValueIds",
	]);
	const changes: CollectionChanges = {};
	if ("name" in fields) {
		changes.name = requiredText(fields.name, "name", NAME_MAX);
	}
	if ("slug" in fields) {
		changes.slug = slugField(fields.slug);
	}
	if ("description" in fields) {
		changes.description =
			optionalText(fields.description, "description", DESCRIPTION_MAX) ??
			"";
	}
	if ("parentId" in fields) {
		changes.parentId = parentId(fields.parentId);
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
	if ("facetValueIds" in fields) {
		changes.facetValueIds = rule(fields.facetValueIds);
	}
	return changes;
}

/** Body of PUT /admin/collections/order: every child of `parentId`, in the new order. */
export function parseCollectionOrder(body: unknown): {
	parentId: CollectionId | null;
	collectionIds: CollectionId[];
} {
	const fields = objectBody(body, ["parentId", "collectionIds"]);
	if (!("parentId" in fields)) {
		invalid("parentId is required; null for the top level");
	}
	return {
		parentId: parentId(fields.parentId),
		collectionIds: idList(
			fields.collectionIds,
			"collectionIds",
			CollectionId,
		),
	};
}

/** Body of PUT /admin/collections/:id/products: the products in order. */
export function parseCollectionProducts(body: unknown): ProductId[] {
	return idList(
		objectBody(body, ["productIds"]).productIds,
		"productIds",
		ProductId,
	);
}
