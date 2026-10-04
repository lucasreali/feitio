import { count, desc, eq } from "drizzle-orm";
import {
	type CustomerEventKind,
	customerEvents,
} from "../database/schemas/customer-events.js";
import { users } from "../database/schemas/users.js";
import type { CustomerId, UserId } from "../domain/ids.js";
import type { Page } from "../http/page.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { CustomerEventDto } from "./customer-history.dto.js";

/** Who changed a customer: a panel user, or null for the buyer or the system. */
export type Actor = UserId | null;

/** Adds an entry to the customer's history, in the transaction of the change. */
export async function recordEvent(
	tx: TenantTransaction,
	customerId: CustomerId,
	kind: CustomerEventKind,
	actor: Actor,
	data: Record<string, unknown> = {},
): Promise<CustomerEventDto> {
	const [{ id }] = await tx
		.insert(customerEvents)
		.values({
			tenantId: TenantContext.id(),
			customerId,
			kind,
			userId: actor,
			data,
		})
		.returning({ id: customerEvents.id });
	const [event] = await entries(tx).where(eq(customerEvents.id, id));
	return toDto(event);
}

/** The customer's history, newest first: one page, or all of it. */
export async function history(
	tx: TenantTransaction,
	customerId: CustomerId,
	page?: Page,
): Promise<{ items: CustomerEventDto[]; total: number }> {
	const query = entries(tx)
		.where(eq(customerEvents.customerId, customerId))
		.orderBy(desc(customerEvents.createdAt), desc(customerEvents.id));
	const [items, [{ total }]] = await Promise.all([
		page ? query.limit(page.pageSize).offset(page.offset) : query,
		tx
			.select({ total: count() })
			.from(customerEvents)
			.where(eq(customerEvents.customerId, customerId)),
	]);
	return { items: items.map(toDto), total };
}

const entries = (tx: TenantTransaction) =>
	tx
		.select({
			id: customerEvents.id,
			kind: customerEvents.kind,
			data: customerEvents.data,
			userId: users.id,
			userName: users.name,
			createdAt: customerEvents.createdAt,
		})
		.from(customerEvents)
		.leftJoin(users, eq(users.id, customerEvents.userId))
		.$dynamic();

const toDto = ({
	userId,
	userName,
	...entry
}: Awaited<ReturnType<typeof entries>>[number]): CustomerEventDto => ({
	...entry,
	// A removed panel user leaves the entry without its author.
	user: userId && userName ? { id: userId, name: userName } : null,
});
