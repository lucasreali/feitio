import { objectBody, requiredText, textList } from "../http/request-body.js";

/** Longest name of a facet or facet value. */
export const FACET_NAME_MAX = 80;

export interface NewFacet {
	name: string;
	values: string[];
}

/** Body of POST /admin/facets. */
export function parseNewFacet(body: unknown): NewFacet {
	const fields = objectBody(body, ["name", "values"]);
	return {
		name: requiredText(fields.name, "name", FACET_NAME_MAX),
		values:
			fields.values === undefined
				? []
				: textList(fields.values, "values", FACET_NAME_MAX),
	};
}
