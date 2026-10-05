import { domainEvents } from "../database/schemas/domain-events.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { DomainEvent } from "./domain-event.js";

/**
 * Publishes an event in the transaction of the change (transactional outbox):
 * it reaches the worker only if the change commits, and is never lost after.
 */
export async function publishEvent(
	tx: TenantTransaction,
	{ type, ...payload }: DomainEvent,
): Promise<void> {
	await tx
		.insert(domainEvents)
		.values({ tenantId: TenantContext.id(), type, payload });
}
