import { type Brand, brandedString } from "./brand.js";

// Deliberately loose: one @, no spaces, a dot in the domain. Whether the
// address exists is only proven by sending to it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LENGTH = 254;

/** An e-mail address, trimmed and lowercased so each address has one spelling. */
export type Email = Brand<string, "Email">;

const parser = brandedString(
	"Email",
	(value) => value.length <= MAX_LENGTH && EMAIL.test(value),
);
const normalize = (value: string) => value.trim().toLowerCase();

export const Email = {
	parse: (value: string): Email => parser.parse(normalize(value)),
	tryParse: (value: string): Email | null =>
		parser.tryParse(normalize(value)),
};
