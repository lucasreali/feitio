import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Seals secrets the API must read back later (a store's gateway API key)
 * with AES-256-GCM, so the database never holds them in clear. Sealed text
 * is `iv.tag.data` in base64; a changed one, or one sealed with another key,
 * fails to open.
 */
export class SecretBox {
	private readonly key: Buffer;

	/** `key`: 32 random bytes in base64 (`openssl rand -base64 32`). */
	constructor(key: string) {
		this.key = Buffer.from(key, "base64");
		if (this.key.length !== 32) {
			throw new Error("The secret key must have 32 bytes, in base64");
		}
	}

	seal(secret: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const data = Buffer.concat([
			cipher.update(secret, "utf8"),
			cipher.final(),
		]);
		return [iv, cipher.getAuthTag(), data]
			.map((part) => part.toString("base64"))
			.join(".");
	}

	open(sealed: string): string {
		const [iv, tag, data] = sealed
			.split(".")
			.map((part) => Buffer.from(part, "base64"));
		const decipher = createDecipheriv(ALGORITHM, this.key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([
			decipher.update(data),
			decipher.final(),
		]).toString("utf8");
	}
}
