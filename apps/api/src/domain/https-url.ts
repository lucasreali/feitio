import { type Brand, brandedString } from "./brand.js";

const MAX_LENGTH = 2048;

const isValid = (value: string) => {
	if (value.length > MAX_LENGTH || !URL.canParse(value)) {
		return false;
	}
	const url = new URL(value);
	// The URL parser would also accept surrounding spaces; keep values exact.
	return (
		url.protocol === "https:" &&
		!url.username &&
		!url.password &&
		value === value.trim()
	);
};

/** An absolute HTTPS address without credentials, such as a store's logo. */
export type HttpsUrl = Brand<string, "HttpsUrl">;
export const HttpsUrl = brandedString("HttpsUrl", isValid);
