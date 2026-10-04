import { AddressDto } from "./customer.dto.js";

/** The signed-in buyer, as the store shows them. */
export class AccountDto {
	id: string;
	email: string;
	name: string;
	/** E.164, such as +5511987654321. */
	phone: string | null;
	/** CPF (11 digits) or CNPJ (14 characters). */
	taxId: string | null;
	/** Defaults first, then oldest first. */
	addresses: AddressDto[];
}

export class SignedInDto {
	/**
	 * Send it as `Authorization: Bearer <token>` with X-Tenant. Keep it on the
	 * store's server (an HttpOnly cookie of the store's own domain), not in
	 * the browser's storage.
	 */
	token: string;
	customer: AccountDto;
}

export class TokenDto {
	/** The new token; every earlier one has ended. */
	token: string;
}

export class RegisterDto {
	email: string;
	/** 8 to 128 characters. */
	password: string;
	/** 1 to 120 characters. */
	name: string;
	phone?: string | null;
	/** CPF or CNPJ, with or without formatting. */
	taxId?: string | null;
}

export class CustomerLoginDto {
	email: string;
	password: string;
}

export class UpdateAccountDto {
	name?: string;
	/** null clears it. */
	phone?: string | null;
	/** null clears it. */
	taxId?: string | null;
}

export class ChangePasswordDto {
	currentPassword: string;
	/** 8 to 128 characters. */
	newPassword: string;
}
