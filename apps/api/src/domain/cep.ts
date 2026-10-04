import { type Brand, brandedString } from "./brand.js";

/** A Brazilian postal code, as its 8 digits. Whether it exists is not checked. */
export type Cep = Brand<string, "Cep">;

const parser = brandedString(
	"Cep",
	(value) => /^\d{8}$/.test(value) && value !== "00000000",
);
const normalize = (value: string) => value.replace(/[-\s]/g, "");

export const Cep = {
	parse: (value: string): Cep => parser.parse(normalize(value)),
	tryParse: (value: string): Cep | null => parser.tryParse(normalize(value)),
};
