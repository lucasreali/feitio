import type { Brand } from "./brand.js";

// Area code (two digits from 1 to 9), then a mobile number (9 and eight
// digits) or a landline (2 to 5 and seven digits).
const NATIONAL = /^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/;

/** A Brazilian phone number in E.164: +55, the area code and the number. */
export type Phone = Brand<string, "Phone">;

const tryParse = (value: string): Phone | null => {
	const compact = value.replace(/[\s().-]/g, "");
	if (!/^\+?\d+$/.test(compact)) {
		return null;
	}
	const digits = compact.replace("+", "");
	if (compact.startsWith("+") && !digits.startsWith("55")) {
		return null;
	}
	const national =
		digits.length > 11 && digits.startsWith("55")
			? digits.slice(2)
			: digits;
	return NATIONAL.test(national) ? (`+55${national}` as Phone) : null;
};

export const Phone = {
	parse(value: string): Phone {
		const phone = tryParse(value);
		if (phone === null) {
			throw new Error(`Invalid Phone: "${value}"`);
		}
		return phone;
	},
	tryParse,
};
