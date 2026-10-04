import { randomBytes } from "node:crypto";

const UUID_V7 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether `value` is a lowercase RFC 9562 version 7 UUID. */
export const isUuidV7 = (value: string) => UUID_V7.test(value);

/**
 * A version 7 UUID (RFC 9562): 48 bits of Unix time in milliseconds, then
 * random bits. Ids sort by creation time, which keeps primary key indexes
 * compact. Ids created in the same millisecond are not ordered among
 * themselves.
 */
export function uuidv7(now = Date.now()): string {
	const bytes = randomBytes(16);
	let time = BigInt(now);
	for (let index = 5; index >= 0; index--) {
		bytes[index] = Number(time & 0xffn);
		time >>= 8n;
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
