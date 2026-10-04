import { FacetValueId } from "../domain/ids.js";
import { Slug } from "../domain/slug.js";
import { type Page, parsePage } from "../http/page.js";
import { idList, invalid } from "../http/request-body.js";

/** `position` is a manual collection's own order. */
export const productSorts = [
	"newest",
	"name",
	"price-asc",
	"price-desc",
	"position",
] as const;

export type ProductSort = (typeof productSorts)[number];

export interface StoreProductQuery {
	collection: Slug | null;
	/** Any value of a facet, and every facet sent. */
	facetValueIds: FacetValueId[];
	/** null: the collection's order for a manual collection, newest otherwise. */
	sort: ProductSort | null;
	page: Page;
}

const single = (query: Record<string, unknown>, name: string) => {
	const value = query[name];
	return value === undefined || typeof value === "string"
		? value
		: invalid(`Send ${name} once`);
};

/** Query string of GET /store/products. */
export function parseStoreProductQuery(
	query: Record<string, unknown>,
): StoreProductQuery {
	const collection = single(query, "collection");
	const facetValueIds = single(query, "facetValueIds");
	const sort = single(query, "sort");
	if (
		sort !== undefined &&
		!(productSorts as readonly string[]).includes(sort)
	) {
		invalid(`sort must be one of ${productSorts.join(", ")}`);
	}
	if (sort === "position" && collection === undefined) {
		invalid("sort=position needs a manual collection");
	}
	return {
		collection:
			collection === undefined
				? null
				: (Slug.tryParse(collection) ??
					invalid("collection must be a collection slug")),
		facetValueIds:
			facetValueIds === undefined
				? []
				: idList(
						facetValueIds.split(","),
						"facetValueIds",
						FacetValueId,
					),
		sort: (sort as ProductSort | undefined) ?? null,
		page: parsePage(query),
	};
}
