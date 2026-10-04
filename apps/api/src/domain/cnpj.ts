import { type Brand, brandedString } from "./brand.js";

/**
 * Check digit of the first `length` characters. Since July 2026 the first 12
 * characters may be letters: each counts as its char code minus 48, so
 * digits keep their value and numeric CNPJs still check the same way.
 */
const checkDigit = (value: string, length: number) => {
	let sum = 0;
	for (let index = 0; index < length; index++) {
		const weight = ((length - 1 - index) % 8) + 2;
		sum += (value.charCodeAt(index) - 48) * weight;
	}
	const rest = sum % 11;
	return rest < 2 ? 0 : 11 - rest;
};

const isValid = (value: string) =>
	/^[0-9A-Z]{12}\d{2}$/.test(value) &&
	!/^(.)\1{13}$/.test(value) &&
	checkDigit(value, 12) === Number(value[12]) &&
	checkDigit(value, 13) === Number(value[13]);

/** A Brazilian company taxpayer number: 12 letters or digits and 2 check digits. */
export type Cnpj = Brand<string, "Cnpj">;

const parser = brandedString("Cnpj", isValid);
// Accepts the usual 00.000.000/0000-00 formatting and stores the characters in capitals.
const normalize = (value: string) =>
	value.replace(/[./\-\s]/g, "").toUpperCase();

export const Cnpj = {
	parse: (value: string): Cnpj => parser.parse(normalize(value)),
	tryParse: (value: string): Cnpj | null => parser.tryParse(normalize(value)),
};
