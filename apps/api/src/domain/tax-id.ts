import { Cnpj } from "./cnpj.js";
import { Cpf } from "./cpf.js";

/** A CPF (11 digits) or a CNPJ (14 characters); the length tells them apart. */
export type TaxId = Cpf | Cnpj;

export const TaxId = {
	parse(value: string): TaxId {
		const taxId = TaxId.tryParse(value);
		if (taxId === null) {
			throw new Error(`Invalid TaxId: "${value}"`);
		}
		return taxId;
	},
	tryParse: (value: string): TaxId | null =>
		Cpf.tryParse(value) ?? Cnpj.tryParse(value),
};
