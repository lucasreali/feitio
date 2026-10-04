import { invalid } from "./request-body.js";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export interface Page {
	page: number;
	pageSize: number;
	offset: number;
}

const positive = (value: unknown, field: string, fallback: number) => {
	if (value === undefined) {
		return fallback;
	}
	const number = typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isSafeInteger(number) && number >= 1
		? number
		: invalid(`${field} must be a whole number from 1`);
};

/** `page` (from 1) and `pageSize` (1 to 100, default 24) from a query string. */
export function parsePage(query: Record<string, unknown>): Page {
	const page = positive(query.page, "page", 1);
	const pageSize = positive(query.pageSize, "pageSize", DEFAULT_PAGE_SIZE);
	if (pageSize > MAX_PAGE_SIZE) {
		invalid(`pageSize must be at most ${MAX_PAGE_SIZE}`);
	}
	return { page, pageSize, offset: (page - 1) * pageSize };
}
