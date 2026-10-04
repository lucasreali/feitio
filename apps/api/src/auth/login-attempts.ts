import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Valkey } from "../valkey/valkey.js";
import { ipBucket } from "./ip-bucket.js";

/** Attempts are counted over this window, from the first one. */
const WINDOW_SECONDS = 15 * 60;
/**
 * Per counter, the attempts allowed in a window:
 * - `pair`: one e-mail from one address. Stops guessing a password without
 *   letting a stranger lock its owner out everywhere.
 * - `email`: one e-mail from anywhere. Caps guessing spread over many
 *   addresses; reaching it does lock the e-mail out for the window.
 * - `ip`: one address (an IPv6 /64) across e-mails.
 */
const LIMITS = { pair: 5, email: 100, ip: 30 } as const;
type Counter = keyof typeof LIMITS;
const COUNTERS = Object.keys(LIMITS) as Counter[];

/**
 * Counts sign-in attempts in Valkey. Every attempt is counted before the
 * password is checked, in one atomic step, so parallel requests cannot all
 * pass the check; a successful sign-in takes its own attempt back.
 */
@Injectable()
export class LoginAttempts {
	constructor(private readonly valkey: Valkey) {}

	/**
	 * Counts an attempt. Returns 0 when it may go ahead, or the seconds until
	 * the e-mail and address may try again. `scope` keeps separate counters
	 * for separate sign-ins (the panel, each store's buyers).
	 */
	async attempt(email: string, ip: string, scope = "panel"): Promise<number> {
		const keys = loginKeys(scope, email, ip);
		const transaction = this.valkey.multi();
		for (const counter of COUNTERS) {
			// NX: the window starts at the first attempt and is not extended.
			transaction
				.incr(keys[counter])
				.expire(keys[counter], WINDOW_SECONDS, "NX")
				.ttl(keys[counter]);
		}
		const results = (await transaction.exec()) as [Error | null, number][];
		return Math.max(
			...COUNTERS.map((counter, index) => {
				const [[, count], , [, ttl]] = results.slice(
					index * 3,
					index * 3 + 3,
				);
				return count > LIMITS[counter] ? ttl : 0;
			}),
		);
	}

	/** A successful sign-in: the pair starts over and the attempt is taken back. */
	async succeeded(email: string, ip: string, scope = "panel"): Promise<void> {
		const keys = loginKeys(scope, email, ip);
		await this.valkey
			.multi()
			.del(keys.pair)
			.decr(keys.email)
			.decr(keys.ip)
			.exec();
	}
}

// The e-mail is hashed so Valkey does not hold a list of addresses.
const loginKeys = (
	scope: string,
	email: string,
	ip: string,
): Record<Counter, string> => {
	const hash = createHash("sha256")
		.update(email.trim().toLowerCase())
		.digest("hex");
	const bucket = ipBucket(ip);
	return {
		pair: `login-attempts:${scope}:pair:${hash}:${bucket}`,
		email: `login-attempts:${scope}:email:${hash}`,
		ip: `login-attempts:${scope}:ip:${bucket}`,
	};
};
