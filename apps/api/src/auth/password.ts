import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// No local imports here: scripts/create-store.ts loads this file directly
// under Node, which cannot follow the `.js` specifiers of src/.

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keyLength: number,
	options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt cost: OWASP's N=2^14, r=8, p=5, as strong as its N=2^17, p=1 but
 * with 16 MiB per hash instead of 128 MiB, so parallel sign-ins cannot
 * exhaust memory. Node runs the p lanes one after another.
 */
const COST = { N: 2 ** 14, r: 8, p: 5 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// scrypt needs 128 * N * r bytes. Sized from the stored parameters, so hashes
// made with a higher cost than Node's default cap (32 MB) still verify.
const maxmem = (N: number, r: number) => 256 * N * r;

/**
 * Hashes a password with scrypt and a random salt. The result carries its
 * own parameters (`scrypt$N$r$p$salt$hash`), so the cost can be raised
 * later without breaking stored hashes.
 */
export async function hashPassword(password: string): Promise<string> {
	const { N, r, p } = COST;
	const salt = randomBytes(SALT_LENGTH);
	const hash = await scryptAsync(password, salt, KEY_LENGTH, {
		N,
		r,
		p,
		maxmem: maxmem(N, r),
	});
	return [
		"scrypt",
		N,
		r,
		p,
		salt.toString("base64"),
		hash.toString("base64"),
	].join("$");
}

/** Whether `password` matches a hash made by hashPassword. Malformed hashes never match. */
export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [scheme, ...rest] = stored.split("$");
	const [salt, hash] = rest.slice(3);
	const params = rest.slice(0, 3).map(Number);
	if (
		scheme !== "scrypt" ||
		!salt ||
		!hash ||
		params.length !== 3 ||
		params.some((value) => !Number.isInteger(value) || value < 1)
	) {
		return false;
	}
	const [N, r, p] = params;
	const expected = Buffer.from(hash, "base64");
	try {
		const actual = await scryptAsync(
			password,
			Buffer.from(salt, "base64"),
			expected.length,
			{ N, r, p, maxmem: maxmem(N, r) },
		);
		return timingSafeEqual(actual, expected);
	} catch {
		// Parameters scrypt refuses (N not a power of two, and so on).
		return false;
	}
}
