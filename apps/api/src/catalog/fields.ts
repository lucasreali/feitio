import { Slug, slugify } from "../domain/slug.js";
import { invalid } from "../http/request-body.js";

/** Limits shared by products and collections. */
export const DESCRIPTION_MAX = 10_000;
export const SEO_TITLE_MAX = 120;
export const SEO_DESCRIPTION_MAX = 320;

/** A slug sent in a body. */
export const slugField = (value: unknown): Slug =>
	(typeof value === "string" && Slug.tryParse(value)) ||
	invalid(
		"slug must be lowercase letters, digits and single dashes, up to 120 characters",
	);

/**
 * The slug sent, or one made from the name when none was sent. A slug made
 * from the name gets a suffix if the store already uses it (freeSlug).
 */
export function newSlug(
	name: string,
	value: unknown,
): { slug: Slug; slugFromName: boolean } {
	if (value !== undefined) {
		return { slug: slugField(value), slugFromName: false };
	}
	return {
		slug:
			slugify(name) ??
			invalid("name has no letters or digits for a slug; send a slug"),
		slugFromName: true,
	};
}
