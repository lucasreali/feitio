import { type Brand, brandedString } from "./brand.js";

const MAX_LENGTH = 64;
// Colors, lengths and keywords. No `;`, braces, quotes, backslashes or angle
// brackets, so a value cannot end its declaration, open a string or escape.
const CHARACTERS = /^[a-zA-Z0-9#.,%()\s/+*-]+$/;
// Functions that only compute colors and lengths: no url(), image-set() or
// anything else that fetches a resource.
const FUNCTIONS = new Set([
	"rgb",
	"rgba",
	"hsl",
	"hsla",
	"hwb",
	"lab",
	"lch",
	"oklab",
	"oklch",
	"color",
	"color-mix",
	"calc",
	"min",
	"max",
	"clamp",
]);

const isValid = (value: string) =>
	value.length <= MAX_LENGTH &&
	CHARACTERS.test(value) &&
	[...value.matchAll(/([a-zA-Z-]*)\(/g)].every(([, name]) =>
		FUNCTIONS.has(name.toLowerCase()),
	);

/**
 * A CSS value for a store theme variable (a color, a length). The stores and
 * the checkout put it in a stylesheet, so only plain values are allowed.
 */
export type ThemeValue = Brand<string, "ThemeValue">;
export const ThemeValue = brandedString("ThemeValue", isValid);
