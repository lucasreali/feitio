import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Valkey } from "../valkey/valkey.js";

/** Failures are counted over this window, from the first one. */
const WINDOW_SECONDS = 15 * 60;
/** Stops guessing one user's password, from any number of addresses. */
const MAX_FAILURES_PER_EMAIL = 5;
/** Stops one address from trying passwords across many e-mails. */
const MAX_FAILURES_PER_IP = 30;

/**
 * Counts failed sign-ins in Valkey, per e-mail and per IP address. Once
 * either reaches its limit, sign-in is refused until the window ends, even
 * with the right password.
 */
@Injectable()
export class LoginAttempts {
	constructor(private readonly valkey: Valkey) {}

	/** Seconds until this e-mail and address may try again; 0 when they may now. */
	async retryAfter(email: string, ip: string): Promise<number> {
		const keys = loginKeys(email, ip);
		const results = (await this.valkey
			.multi()
			.get(keys.email)
			.ttl(keys.email)
			.get(keys.ip)
			.ttl(keys.ip)
			.exec()) as [Error | null, string | number | null][];
		const [failuresByEmail, emailTtl, failuresByIp, ipTtl] = results.map(
			([, value]) => Number(value ?? 0),
		);
		return Math.max(
			failuresByEmail >= MAX_FAILURES_PER_EMAIL ? emailTtl : 0,
			failuresByIp >= MAX_FAILURES_PER_IP ? ipTtl : 0,
		);
	}

	async recordFailure(email: string, ip: string): Promise<void> {
		const keys = loginKeys(email, ip);
		// NX: the window starts at the first failure and is not extended.
		await this.valkey
			.multi()
			.incr(keys.email)
			.expire(keys.email, WINDOW_SECONDS, "NX")
			.incr(keys.ip)
			.expire(keys.ip, WINDOW_SECONDS, "NX")
			.exec();
	}

	/** A successful sign-in clears the e-mail's count, not the address's. */
	async reset(email: string): Promise<void> {
		await this.valkey.del(loginKeys(email, "").email);
	}
}

// The e-mail is hashed so Valkey does not hold a list of addresses.
const loginKeys = (email: string, ip: string) => ({
	email: `login-failures:email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`,
	ip: `login-failures:ip:${ip}`,
});
