import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PaymentAccountId, TenantId } from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * The store's account at the payment gateway (an Asaas subaccount), which
 * receives its sales. One per store, created by the API and never removed.
 */
export const paymentAccounts = pgTable(
	"payment_accounts",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<PaymentAccountId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.unique("payment_accounts_tenant_unique")
			.references(() => tenants.id, { onDelete: "cascade" }),
		/** The account's id at the gateway. */
		gatewayAccountId: text("gateway_account_id").notNull(),
		/** Where split parts of payments go. */
		walletId: text("wallet_id").notNull(),
		/** The account's API key, sealed with SecretBox: never in clear. */
		credential: text("credential").notNull(),
		/** SHA-256 (hex) of the token the gateway sends with the store's webhooks. */
		webhookTokenHash: text("webhook_token_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		check(
			"payment_accounts_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("payment_accounts"),
	],
).enableRLS();
