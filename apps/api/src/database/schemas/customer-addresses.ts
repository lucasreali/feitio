import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	foreignKey,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { Cep } from "../../domain/cep.js";
import type {
	CustomerAddressId,
	CustomerId,
	TenantId,
} from "../../domain/ids.js";
import type { Phone } from "../../domain/phone.js";
import type { BrazilianState } from "../../domain/state.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { customers } from "./customers.js";
import { tenants } from "./tenants.js";

/**
 * An address in a customer's address book. At most one is the default for
 * shipping and one for billing; they can be the same address.
 */
export const customerAddresses = pgTable(
	"customer_addresses",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<CustomerAddressId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		customerId: uuid("customer_id").$type<CustomerId>().notNull(),
		/** Who receives the parcel. */
		recipient: text("recipient").notNull(),
		phone: text("phone").$type<Phone>(),
		cep: text("cep").notNull().$type<Cep>(),
		street: text("street").notNull(),
		/** Text, since "s/n" and "123A" are common. */
		number: text("number").notNull(),
		complement: text("complement"),
		neighborhood: text("neighborhood").notNull(),
		city: text("city").notNull(),
		state: text("state").notNull().$type<BrazilianState>(),
		isDefaultShipping: boolean("is_default_shipping")
			.notNull()
			.default(false),
		isDefaultBilling: boolean("is_default_billing")
			.notNull()
			.default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		foreignKey({
			name: "customer_addresses_customer_fk",
			columns: [table.tenantId, table.customerId],
			foreignColumns: [customers.tenantId, customers.id],
		}).onDelete("cascade"),
		index("customer_addresses_customer_idx").on(table.customerId),
		uniqueIndex("customer_addresses_one_default_shipping")
			.on(table.customerId)
			.where(sql`${table.isDefaultShipping}`),
		uniqueIndex("customer_addresses_one_default_billing")
			.on(table.customerId)
			.where(sql`${table.isDefaultBilling}`),
		check(
			"customer_addresses_cep_digits",
			sql`${table.cep} ~ '^[0-9]{8}$'`,
		),
		check(
			"customer_addresses_state_format",
			sql`${table.state} ~ '^[A-Z]{2}$'`,
		),
		check(
			"customer_addresses_phone_e164",
			sql`${table.phone} ~ '^\\+55[0-9]{10,11}$'`,
		),
		check(
			"customer_addresses_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("customer_addresses"),
	],
).enableRLS();
