import { sql } from "drizzle-orm";
import {
	check,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { Email } from "../../domain/email.js";
import type { CustomerId, TenantId } from "../../domain/ids.js";
import type { Phone } from "../../domain/phone.js";
import type { TaxId } from "../../domain/tax-id.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { tenants } from "./tenants.js";

/**
 * A buyer of the store. Without a password it is a guest (bought without an
 * account, or added by the panel); with one it is registered and can sign in
 * to the store. One customer per e-mail in each store.
 */
export const customers = pgTable(
	"customers",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<CustomerId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		/** Always lowercase (Email normalizes it), so `unique` covers every spelling. */
		email: text("email").notNull().$type<Email>(),
		name: text("name").notNull(),
		/** E.164, from Phone. */
		phone: text("phone").$type<Phone>(),
		/** CPF (11 digits) or CNPJ (14 characters), from TaxId. */
		taxId: text("tax_id").$type<TaxId>(),
		/** scrypt hash from src/auth/password.ts; null for guests. */
		passwordHash: text("password_hash"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("customers_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("customers_tenant_email_unique").on(table.tenantId, table.email),
		check(
			"customers_email_lowercase",
			sql`${table.email} = lower(${table.email})`,
		),
		check(
			"customers_phone_e164",
			sql`${table.phone} ~ '^\\+55[0-9]{10,11}$'`,
		),
		check(
			"customers_tax_id_format",
			sql`${table.taxId} ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'`,
		),
		check(
			"customers_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("customers"),
	],
).enableRLS();
