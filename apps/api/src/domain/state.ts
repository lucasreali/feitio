import { type Brand, brandedString } from "./brand.js";

const STATES = new Set([
	"AC",
	"AL",
	"AM",
	"AP",
	"BA",
	"CE",
	"DF",
	"ES",
	"GO",
	"MA",
	"MG",
	"MS",
	"MT",
	"PA",
	"PB",
	"PE",
	"PI",
	"PR",
	"RJ",
	"RN",
	"RO",
	"RR",
	"RS",
	"SC",
	"SE",
	"SP",
	"TO",
]);

/** The two-letter abbreviation of a Brazilian state or the Federal District. */
export type BrazilianState = Brand<string, "BrazilianState">;

const parser = brandedString("BrazilianState", (value) => STATES.has(value));
const normalize = (value: string) => value.trim().toUpperCase();

export const BrazilianState = {
	parse: (value: string): BrazilianState => parser.parse(normalize(value)),
	tryParse: (value: string): BrazilianState | null =>
		parser.tryParse(normalize(value)),
};
