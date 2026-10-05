import { sql } from "drizzle-orm";
import {
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { OrderId, PaymentId, TenantId } from "../../domain/ids.js";
import type { Money } from "../../domain/money.js";
import {
	PAYMENT_METHODS,
	type PaymentDetails,
} from "../../payments/payment-gateway.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { orders } from "./orders.js";
import { tenants } from "./tenants.js";

export const paymentMethod = pgEnum("payment_method", PAYMENT_METHODS);

export const paymentStatus = pgEnum("payment_status", [
	"pending",
	"confirmed",
	"failed",
	"refunded",
]);

/**
 * One charge of an order at the gateway. An order has at most one payment
 * pending or confirmed; failed ones stay as its history. `gateway_id` is
 * null until the gateway answers. Card data never reaches this table: only
 * the brand and last digits, in `details`.
 */
export const payments = pgTable(
	"payments",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<PaymentId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		orderId: uuid("order_id").$type<OrderId>().notNull(),
		method: paymentMethod("method").notNull(),
		status: paymentStatus("status").notNull().default("pending"),
		amount: integer("amount").notNull().$type<Money>(),
		/** What went back to the buyer, in cents. */
		refunded: integer("refunded").notNull().default(0).$type<Money>(),
		/** The charge's id at the gateway. */
		gatewayId: text("gateway_id"),
		/** What the buyer pays with: the Pix code, the boleto's line, the card's brand and last digits. */
		details: jsonb("details").$type<PaymentDetails>().notNull().default({}),
		/** Why the gateway refused the charge, for the buyer. */
		failure: text("failure"),
		/** The last day to pay, in Brazil. */
		dueDate: date("due_date").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("payments_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("payments_tenant_gateway_id_unique").on(
			table.tenantId,
			table.gatewayId,
		),
		uniqueIndex("payments_order_open_unique")
			.on(table.tenantId, table.orderId)
			.where(sql`${table.status} in ('pending', 'confirmed')`),
		foreignKey({
			name: "payments_order_fk",
			columns: [table.tenantId, table.orderId],
			foreignColumns: [orders.tenantId, orders.id],
		}).onDelete("cascade"),
		index("payments_order_idx").on(table.orderId),
		index("payments_status_idx").on(
			table.tenantId,
			table.status,
			table.createdAt,
		),
		check("payments_amount_positive", sql`${table.amount} > 0`),
		check(
			"payments_refunded_within_amount",
			sql`${table.refunded} between 0 and ${table.amount}`,
		),
		check(
			"payments_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("payments"),
	],
).enableRLS();
