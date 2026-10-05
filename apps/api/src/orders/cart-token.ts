import { createHash, randomBytes } from "node:crypto";

/** 256 random bits in base64url. */
const TOKEN = /^[\w-]{43}$/;

/** A new cart's token, for the store only, and the SHA-256 the database keeps. */
export function newCartToken(): { token: string; hash: string } {
	const token = randomBytes(32).toString("base64url");
	return { token, hash: hashToken(token) };
}

/** The hash behind a token from a request; null for anything that is not a token. */
export function cartTokenHash(value: unknown): string | null {
	return typeof value === "string" && TOKEN.test(value)
		? hashToken(value)
		: null;
}

const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("hex");
