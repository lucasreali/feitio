import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
	BadGatewayException,
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { paymentAccounts } from "../database/schemas/payment-accounts.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type { PaymentAccountDto } from "./payment.dto.js";
import {
	GatewayRefusal,
	type MerchantAccountInput,
	PAYMENT_GATEWAY,
	type PaymentGateway,
} from "./payment-gateway.js";
import { PAYMENT_SETTINGS, type PaymentSettings } from "./payment-settings.js";
import { SecretBox } from "./secret-box.js";

const logger = new Logger("PaymentAccounts");

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

const view = {
	walletId: paymentAccounts.walletId,
	createdAt: paymentAccounts.createdAt,
};

/**
 * The current store's account at the gateway: opened once by its owner,
 * with the webhook the gateway notifies its payments to. The account's key
 * is kept sealed (SecretBox) and the webhook's token only as its SHA-256.
 */
@Injectable()
export class PaymentAccounts {
	constructor(
		private readonly tenantDb: TenantDatabase,
		@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
		@Inject(PAYMENT_SETTINGS) private readonly settings: PaymentSettings,
		private readonly box: SecretBox,
	) {}

	async find(): Promise<PaymentAccountDto | null> {
		const [account] = await this.tenantDb.run((tx) =>
			tx.select(view).from(paymentAccounts),
		);
		return account ?? null;
	}

	/**
	 * Opens the store's account at the gateway. 409 when it has one; 400
	 * when the gateway refuses the data, with its message; 502 when it fails.
	 *
	 * ponytail: the gateway is called inside the transaction that holds the
	 * store's lock, so two openings never make two accounts (the gateway
	 * answers each key only once). A commit that fails after the call leaves
	 * an account at the gateway with no key here; it is a rare owner action.
	 */
	open(
		input: Omit<MerchantAccountInput, "webhook">,
	): Promise<PaymentAccountDto> {
		return this.tenantDb.run(async (tx) => {
			const tenantId = TenantContext.id();
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`payment-account:${tenantId}`}, 0))`,
			);
			if ((await tx.select(view).from(paymentAccounts)).length > 0) {
				throw new ConflictException(
					"The store already has a payment account",
				);
			}
			const token = randomBytes(32).toString("hex");
			const account = await this.gateway
				.createAccount({
					...input,
					webhook: {
						url: `${this.settings.publicApiUrl}/webhooks/asaas/${tenantId}`,
						token,
					},
				})
				.catch((error: unknown) => {
					if (error instanceof GatewayRefusal) {
						throw new BadRequestException(error.message);
					}
					logger.error(`Opening the account failed: ${error}`);
					throw new BadGatewayException(
						"The payment gateway did not answer; try again",
					);
				});
			const [created] = await tx
				.insert(paymentAccounts)
				.values({
					tenantId,
					gatewayAccountId: account.accountId,
					walletId: account.walletId,
					credential: this.box.seal(account.credential),
					webhookTokenHash: sha256(token),
				})
				.returning(view);
			return created;
		});
	}

	/** The store's credential at the gateway, in the caller's transaction; null without an account. */
	async credential(tx: TenantTransaction): Promise<string | null> {
		const [account] = await tx
			.select({ credential: paymentAccounts.credential })
			.from(paymentAccounts);
		return account ? this.box.open(account.credential) : null;
	}

	/** Whether `token` is the one the gateway sends with the store's webhooks. */
	async acceptsWebhook(
		tx: TenantTransaction,
		token: string | undefined,
	): Promise<boolean> {
		const [account] = await tx
			.select({ hash: paymentAccounts.webhookTokenHash })
			.from(paymentAccounts);
		if (!account || !token) {
			return false;
		}
		return timingSafeEqual(
			Buffer.from(sha256(token), "hex"),
			Buffer.from(account.hash, "hex"),
		);
	}
}
