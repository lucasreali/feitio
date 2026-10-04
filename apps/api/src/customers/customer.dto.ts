export class AddressDto {
	id: string;
	/** Who receives the parcel. */
	recipient: string;
	/** E.164, such as +5511987654321. */
	phone: string | null;
	/** 8 digits. */
	cep: string;
	street: string;
	number: string;
	complement: string | null;
	neighborhood: string;
	city: string;
	/** Two-letter abbreviation, such as SP. */
	state: string;
	defaultShipping: boolean;
	defaultBilling: boolean;
}

export class CustomerDto {
	id: string;
	email: string;
	name: string;
	/** E.164, such as +5511987654321. */
	phone: string | null;
	/** CPF (11 digits) or CNPJ (14 characters). */
	taxId: string | null;
	/** Has an account in the store; false for guests. */
	registered: boolean;
	createdAt: Date;
	/** Defaults first, then oldest first. */
	addresses: AddressDto[];
}

export class CustomerSummaryDto {
	id: string;
	email: string;
	name: string;
	phone: string | null;
	registered: boolean;
	createdAt: Date;
}

export class CustomerPageDto {
	items: CustomerSummaryDto[];
	page: number;
	pageSize: number;
	/** Customers in every page. */
	total: number;
}

export class CreateCustomerDto {
	email: string;
	/** 1 to 120 characters. */
	name: string;
	/** Brazilian number, with or without +55 and formatting. */
	phone?: string | null;
	/** CPF or CNPJ, with or without formatting. */
	taxId?: string | null;
}

export class UpdateCustomerDto {
	email?: string;
	name?: string;
	/** null clears it. */
	phone?: string | null;
	/** null clears it. */
	taxId?: string | null;
}

export class CreateAddressDto {
	/** 1 to 120 characters. */
	recipient: string;
	phone?: string | null;
	/** 8 digits, with or without the dash. */
	cep: string;
	street: string;
	/** Up to 20 characters, such as 123A or s/n. */
	number: string;
	complement?: string | null;
	neighborhood: string;
	city: string;
	/** Two-letter abbreviation, such as SP. */
	state: string;
	/** Makes it the default shipping address, in place of the current one. */
	defaultShipping?: boolean;
	/** Makes it the default billing address, in place of the current one. */
	defaultBilling?: boolean;
}

export class UpdateAddressDto {
	recipient?: string;
	phone?: string | null;
	cep?: string;
	street?: string;
	number?: string;
	complement?: string | null;
	neighborhood?: string;
	city?: string;
	state?: string;
	/** true takes the default from another address; false leaves none. */
	defaultShipping?: boolean;
	defaultBilling?: boolean;
}
