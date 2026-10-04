import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Brand } from "../domain/brand.js";
import type { CustomerId, TenantId } from "../domain/ids.js";
import { Valkey } from "../valkey/valkey.js";

/** A buyer's session ends after this long without use. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

/** What a buyer's session stores. The token itself is never stored. */
export interface CustomerSession {
	customerId: CustomerId;
	tenantId: TenantId;
	/** ISO 8601. */
	createdAt: string;
}

/** A session read from a request, with the id that ends it. */
export interface CurrentCustomerSession extends CustomerSession {
	id: SessionId;
}

/**
 * Buyers' sessions in the stores, kept in Valkey apart from the panel's. The
 * store gets a random 256-bit token and sends it as `Authorization: Bearer`:
 * a header, not a cookie, because each store lives on its own domain, and
 * with no ambient credential there is no CSRF to guard against. Valkey keys
 * use the token's SHA-256, and each use renews the expiration.
 */
@Injectable()
export class CustomerSessions {
	constructor(private readonly valkey: Valkey) {}

	/** Starts a session; answers its token, shown to the store only now. */
	async create(customerId: CustomerId, tenantId: TenantId): Promise<string> {
		const token = randomBytes(32).toString("base64url");
		const session: CustomerSession = {
			customerId,
			tenantId,
			createdAt: new Date().toISOString(),
		};
		const id = hashToken(token);
		await this.valkey
			.multi()
			.set(sessionKey(id), JSON.stringify(session), "EX", TTL_SECONDS)
			.sadd(customerSessionsKey(customerId), id)
			.expire(customerSessionsKey(customerId), TTL_SECONDS)
			.exec();
		return token;
	}

	/** The session behind a token, renewed; null when unknown or expired. */
	async read(token: string): Promise<CurrentCustomerSession | null> {
		const id = hashToken(token);
		const stored = await this.valkey.getex(
			sessionKey(id),
			"EX",
			TTL_SECONDS,
		);
		if (!stored) {
			return null;
		}
		const session = JSON.parse(stored) as CustomerSession;
		await this.valkey.expire(
			customerSessionsKey(session.customerId),
			TTL_SECONDS,
		);
		return { ...session, id };
	}

	async destroy(session: CurrentCustomerSession): Promise<void> {
		await this.valkey
			.multi()
			.del(sessionKey(session.id))
			.srem(customerSessionsKey(session.customerId), session.id)
			.exec();
	}

	/** Ends every session of a buyer: on a password change and on erasure. */
	async destroyAll(customerId: CustomerId): Promise<void> {
		const ids = await this.valkey.smembers(customerSessionsKey(customerId));
		// The index only holds ids written by create().
		await this.valkey.del(
			customerSessionsKey(customerId),
			...ids.map((id) => sessionKey(id as SessionId)),
		);
	}
}

/** A session's id in Valkey: the SHA-256 of its token. */
type SessionId = Brand<string, "CustomerSessionId">;

const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("hex") as SessionId;
const sessionKey = (id: SessionId) => `customer-session:${id}`;
const customerSessionsKey = (customerId: CustomerId) =>
	`customer-sessions:${customerId}`;
