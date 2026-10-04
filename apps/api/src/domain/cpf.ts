import { type Brand, brandedString } from "./brand.js";

/** Check digit of the first `length` digits, by the Receita Federal rule. */
const checkDigit = (digits: string, length: number) => {
	let sum = 0;
	for (let index = 0; index < length; index++) {
		sum += Number(digits[index]) * (length + 1 - index);
	}
	const rest = (sum * 10) % 11;
	return rest === 10 ? 0 : rest;
};

const isValid = (value: string) =>
	/^\d{11}$/.test(value) &&
	// Repeated digits pass the check digits but are not real CPFs.
	!/^(\d)\1{10}$/.test(value) &&
	checkDigit(value, 9) === Number(value[9]) &&
	checkDigit(value, 10) === Number(value[10]);

/** A Brazilian individual taxpayer number, as its 11 digits. */
export type Cpf = Brand<string, "Cpf">;

const parser = brandedString("Cpf", isValid);
// Accepts the usual 000.000.000-00 formatting and stores only the digits.
const normalize = (value: string) => value.replace(/[.\-\s]/g, "");

export const Cpf = {
	parse: (value: string): Cpf => parser.parse(normalize(value)),
	tryParse: (value: string): Cpf | null => parser.tryParse(normalize(value)),
};
