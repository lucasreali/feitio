import { type Brand, brandedString } from "./brand.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LENGTH = 120;

/** Public identifier of a product or collection in store URLs, unique per tenant. */
export type Slug = Brand<string, "Slug">;
export const Slug = brandedString(
	"Slug",
	(value) => value.length <= MAX_LENGTH && SLUG.test(value),
);

/** A slug from a name ("Camiseta Básica" → "camiseta-basica"), or null if nothing is left. */
export function slugify(name: string): Slug | null {
	const slug = name
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, MAX_LENGTH)
		.replace(/^-+|-+$/g, "");
	return Slug.tryParse(slug);
}
