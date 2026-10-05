import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import type { Cep } from "../../domain/cep.js";
import type { HttpsUrl } from "../../domain/https-url.js";
import type {
	CustomerId,
	OrderId,
	ShippingMethodId,
	TenantId,
} from "../../domain/ids.js";
import type { Money } from "../../domain/money.js";
import type { Phone } from "../../domain/phone.js";
import type { BrazilianState } from "../../domain/state.js";
import { ORDER_STATES } from "../../orders/order-state.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { customers } from "./customers.js";
import { shippingMethods } from "./shipping-methods.js";
import { tenants } from "./tenants.js";

export const orderState = pgEnum("order_state", ORDER_STATES);

/** An address as the order keeps it: a copy, so later edits to the address book do not change it. */
export interface OrderAddress {
	recipient: string;
	phone: Phone | null;
	cep: Cep;
	street: string;
	number: string;
	complement: string | null;
	neighborhood: string;
	city: string;
	state: BrazilianState;
}

/**
 * An order of the store. The cart is the order in state `cart`: the store
 * holds a random token for it, and the table keeps only the token's SHA-256.
 * The number is given when the order is first placed, so abandoned carts
 * leave no gaps. Totals are in cents and always add up.
 */
export const orders = pgTable(
	"orders",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<OrderId>(),
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		/** SHA-256 (hex) of the token the store holds for the order. */
		tokenHash: text("token_hash").notNull(),
		/** Sequential per store, from 1; null until the order is placed. */
		number: integer("number"),
		state: orderState("state").notNull().default("cart"),
		/** Null for a cart without a buyer yet, and after the customer is erased. */
		customerId: uuid("customer_id").$type<CustomerId>(),
		shippingAddress: jsonb("shipping_address").$type<OrderAddress>(),
		billingAddress: jsonb("billing_address").$type<OrderAddress>(),
		subtotal: integer("subtotal").notNull().default(0).$type<Money>(),
		discount: integer("discount").notNull().default(0).$type<Money>(),
		shipping: integer("shipping").notNull().default(0).$type<Money>(),
		total: integer("total").notNull().default(0).$type<Money>(),
		/**
		 * The shipping the buyer chose, priced into `shipping`. Changing the
		 * lines or the CEP clears it, so the price always fits the cart.
		 */
		shippingMethodId: uuid("shipping_method_id").$type<ShippingMethodId>(),
		/** Copy of the method's name, as the buyer chose it. */
		shippingMethodName: text("shipping_method_name"),
		/** Business days to deliver, as quoted; null when the method does not say. */
		shippingDeliveryDays: integer("shipping_delivery_days"),
		/** The carrier's tracking code, set by the staff when shipping. */
		trackingCode: text("tracking_code"),
		/** Where the staff prints the shipping label. */
		labelUrl: text("label_url").$type<HttpsUrl>(),
		/** When the order was first placed. */
		placedAt: timestamp("placed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		unique("orders_tenant_id_id_unique").on(table.tenantId, table.id),
		unique("orders_tenant_token_hash_unique").on(
			table.tenantId,
			table.tokenHash,
		),
		unique("orders_tenant_number_unique").on(table.tenantId, table.number),
		// Erasing a customer keeps their orders: the migration narrows the
		// action to SET NULL (customer_id), keeping tenant_id.
		foreignKey({
			name: "orders_customer_fk",
			columns: [table.tenantId, table.customerId],
			foreignColumns: [customers.tenantId, customers.id],
		}).onDelete("set null"),
		foreignKey({
			name: "orders_shipping_method_fk",
			columns: [table.tenantId, table.shippingMethodId],
			foreignColumns: [shippingMethods.tenantId, shippingMethods.id],
		}),
		index("orders_customer_idx").on(table.customerId),
		index("orders_state_updated_idx").on(
			table.tenantId,
			table.state,
			table.updatedAt,
		),
		check("orders_number_positive", sql`${table.number} > 0`),
		check(
			"orders_shipping_delivery_days_positive",
			sql`${table.shippingDeliveryDays} > 0`,
		),
		check(
			"orders_shipping_method_named",
			sql`(${table.shippingMethodId} is null) = (${table.shippingMethodName} is null)`,
		),
		check(
			"orders_amounts_not_negative",
			sql`${table.subtotal} >= 0 and ${table.discount} >= 0 and ${table.shipping} >= 0 and ${table.total} >= 0`,
		),
		check(
			"orders_total_adds_up",
			sql`${table.total} = ${table.subtotal} - ${table.discount} + ${table.shipping}`,
		),
		check(
			"orders_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		tenantIsolation("orders"),
	],
).enableRLS();
