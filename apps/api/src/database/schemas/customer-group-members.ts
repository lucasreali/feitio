import {
	foreignKey,
	index,
	pgTable,
	primaryKey,
	uuid,
} from "drizzle-orm/pg-core";
import type {
	CustomerGroupId,
	CustomerId,
	TenantId,
} from "../../domain/ids.js";
import { tenantIsolation } from "../tenant-isolation.js";
import { customerGroups } from "./customer-groups.js";
import { customers } from "./customers.js";
import { tenants } from "./tenants.js";

/** A customer in a group. */
export const customerGroupMembers = pgTable(
	"customer_group_members",
	{
		tenantId: uuid("tenant_id")
			.$type<TenantId>()
			.notNull()
			.references(() => tenants.id, { onDelete: "cascade" }),
		groupId: uuid("group_id").$type<CustomerGroupId>().notNull(),
		customerId: uuid("customer_id").$type<CustomerId>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.groupId, table.customerId] }),
		foreignKey({
			name: "customer_group_members_group_fk",
			columns: [table.tenantId, table.groupId],
			foreignColumns: [customerGroups.tenantId, customerGroups.id],
		}).onDelete("cascade"),
		foreignKey({
			name: "customer_group_members_customer_fk",
			columns: [table.tenantId, table.customerId],
			foreignColumns: [customers.tenantId, customers.id],
		}).onDelete("cascade"),
		index("customer_group_members_customer_idx").on(table.customerId),
		tenantIsolation("customer_group_members"),
	],
).enableRLS();
