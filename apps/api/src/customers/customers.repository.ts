import {
	BadRequestException,
	ConflictException,
	Injectable,
} from "@nestjs/common";
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { customerAddresses } from "../database/schemas/customer-addresses.js";
import { customerGroupMembers } from "../database/schemas/customer-group-members.js";
import { customerGroups } from "../database/schemas/customer-groups.js";
import { customers } from "../database/schemas/customers.js";
import type { Email } from "../domain/email.js";
import type {
	CustomerAddressId,
	CustomerGroupId,
	CustomerId,
} from "../domain/ids.js";
import type { Page } from "../http/page.js";
import {
	customerOrders,
	releaseCustomerOrders,
} from "../orders/customer-orders.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type {
	AddressDto,
	CustomerDto,
	CustomerExportDto,
	CustomerSummaryDto,
} from "./customer.dto.js";
import type { CustomerEventDto } from "./customer-history.dto.js";
import { type Actor, history, recordEvent } from "./customer-history.js";
import type {
	AddressChanges,
	CustomerChanges,
	Guest,
	NewAddress,
	NewCustomer,
} from "./customer-input.js";

const customerConstraints = {
	customers_tenant_email_unique: () =>
		new ConflictException(
			"The store already has a customer with this e-mail",
		),
	customer_group_members_group_fk: () =>
		new BadRequestException("groupIds has a group the store does not have"),
};

/** Replaces the customer's groups, and records the groups joined and left. */
async function setGroups(
	tx: TenantTransaction,
	customerId: CustomerId,
	groupIds: CustomerGroupId[],
	actor: Actor,
) {
	const before = await tx
		.delete(customerGroupMembers)
		.where(eq(customerGroupMembers.customerId, customerId))
		.returning({ groupId: customerGroupMembers.groupId });
	if (groupIds.length > 0) {
		await tx.insert(customerGroupMembers).values(
			groupIds.map((groupId) => ({
				tenantId: TenantContext.id(),
				groupId,
				customerId,
			})),
		);
	}
	const was = new Set(before.map((row) => row.groupId));
	const changes = [
		...groupIds
			.filter((id) => !was.has(id))
			.map((id) => ["added_to_group", id] as const),
		...[...was]
			.filter((id) => !groupIds.includes(id))
			.map((id) => ["removed_from_group", id] as const),
	];
	if (changes.length === 0) {
		return;
	}
	const names = new Map(
		(
			await tx
				.select({ id: customerGroups.id, name: customerGroups.name })
				.from(customerGroups)
				.where(
					inArray(
						customerGroups.id,
						changes.map(([, id]) => id),
					),
				)
		).map((group) => [group.id, group.name]),
	);
	for (const [kind, groupId] of changes) {
		await recordEvent(tx, customerId, kind, actor, {
			groupId,
			groupName: names.get(groupId),
		});
	}
}

const summary = {
	id: customers.id,
	email: customers.email,
	name: customers.name,
	phone: customers.phone,
	registered: sql`${customers.passwordHash} is not null`.mapWith(Boolean),
	createdAt: customers.createdAt,
};

const address = {
	id: customerAddresses.id,
	recipient: customerAddresses.recipient,
	phone: customerAddresses.phone,
	cep: customerAddresses.cep,
	street: customerAddresses.street,
	number: customerAddresses.number,
	complement: customerAddresses.complement,
	neighborhood: customerAddresses.neighborhood,
	city: customerAddresses.city,
	state: customerAddresses.state,
	defaultShipping: customerAddresses.isDefaultShipping,
	defaultBilling: customerAddresses.isDefaultBilling,
};

/** `%` and `_` in a search are text, not wildcards. */
export const contains = (text: string) =>
	`%${text.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Locks the customer's row for the rest of the transaction, so writes to its
 * addresses (one default of each kind) do not race. false when the tenant
 * has no such customer.
 */
export async function lockCustomer(
	tx: TenantTransaction,
	id: CustomerId,
): Promise<boolean> {
	const rows = await tx
		.select({ id: customers.id })
		.from(customers)
		.where(eq(customers.id, id))
		.for("update");
	return rows.length > 0;
}

/**
 * The customer behind a guest's e-mail, added (and recorded) when the store
 * has none. A guest the store already has is kept as it is: anyone can type
 * an e-mail. 409 for a registered customer, who must sign in.
 */
export async function guestCustomer(
	tx: TenantTransaction,
	{ email, name, phone, taxId }: Guest,
): Promise<CustomerId> {
	const [added] = await tx
		.insert(customers)
		.values({ tenantId: TenantContext.id(), email, name, phone, taxId })
		.onConflictDoNothing({ target: [customers.tenantId, customers.email] })
		.returning({ id: customers.id });
	if (added) {
		await recordEvent(tx, added.id, "created", null);
		return added.id;
	}
	const [customer] = await tx
		.select({ id: customers.id, passwordHash: customers.passwordHash })
		.from(customers)
		.where(eq(customers.email, email));
	if (customer.passwordHash !== null) {
		throw new ConflictException(
			"The store has an account with this e-mail; sign in to use it",
		);
	}
	return customer.id;
}

/** Address fields as columns; a new default takes the place of the current one. */
async function addressColumns(
	tx: TenantTransaction,
	customerId: CustomerId,
	{ defaultShipping, defaultBilling, ...fields }: AddressChanges,
) {
	if (defaultShipping) {
		await tx
			.update(customerAddresses)
			.set({ isDefaultShipping: false })
			.where(
				and(
					eq(customerAddresses.customerId, customerId),
					eq(customerAddresses.isDefaultShipping, true),
				),
			);
	}
	if (defaultBilling) {
		await tx
			.update(customerAddresses)
			.set({ isDefaultBilling: false })
			.where(
				and(
					eq(customerAddresses.customerId, customerId),
					eq(customerAddresses.isDefaultBilling, true),
				),
			);
	}
	return {
		...fields,
		isDefaultShipping: defaultShipping,
		isDefaultBilling: defaultBilling,
	};
}

/** The current tenant's customers and their address books. */
@Injectable()
export class CustomersRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** Newest first; `search` matches part of the name or the e-mail. */
	list(
		page: Page,
		filter: { search?: string; groupId?: CustomerGroupId },
	): Promise<{ items: CustomerSummaryDto[]; total: number }> {
		const { search, groupId } = filter;
		const where: SQL | undefined = and(
			search
				? or(
						ilike(customers.name, contains(search)),
						ilike(customers.email, contains(search)),
					)
				: undefined,
			groupId
				? sql`exists (select 1 from ${customerGroupMembers} where ${customerGroupMembers.customerId} = ${customers.id} and ${customerGroupMembers.groupId} = ${groupId})`
				: undefined,
		);
		return this.tenantDb.run(async (tx) => {
			const [items, [{ total }]] = await Promise.all([
				tx
					.select(summary)
					.from(customers)
					.where(where)
					.orderBy(desc(customers.createdAt), desc(customers.id))
					.limit(page.pageSize)
					.offset(page.offset),
				tx.select({ total: count() }).from(customers).where(where),
			]);
			return { items, total };
		});
	}

	find(id: CustomerId): Promise<CustomerDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [customer] = await tx
				.select({ ...summary, taxId: customers.taxId })
				.from(customers)
				.where(eq(customers.id, id));
			if (!customer) {
				return undefined;
			}
			const addresses: AddressDto[] = await tx
				.select(address)
				.from(customerAddresses)
				.where(eq(customerAddresses.customerId, id))
				.orderBy(
					desc(customerAddresses.isDefaultShipping),
					desc(customerAddresses.isDefaultBilling),
					asc(customerAddresses.createdAt),
					asc(customerAddresses.id),
				);
			const groups = await tx
				.select({ id: customerGroups.id, name: customerGroups.name })
				.from(customerGroupMembers)
				.innerJoin(
					customerGroups,
					eq(customerGroups.id, customerGroupMembers.groupId),
				)
				.where(eq(customerGroupMembers.customerId, id))
				.orderBy(asc(customerGroups.name), asc(customerGroups.id));
			return { ...customer, addresses, groups };
		});
	}

	/** A customer without an account. Throws 409 for an e-mail in use, 400 for an unknown group. */
	create(
		{ groupIds, ...fields }: NewCustomer,
		actor: Actor,
	): Promise<CustomerId> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [{ id }] = await tx
						.insert(customers)
						.values({ ...fields, tenantId: TenantContext.id() })
						.returning({ id: customers.id });
					await recordEvent(tx, id, "created", actor);
					await setGroups(tx, id, groupIds, actor);
					return id;
				}),
			customerConstraints,
		);
	}

	/** false when the tenant has no such customer; 409 for an e-mail in use, 400 for an unknown group. */
	update(
		id: CustomerId,
		{ groupIds, ...fields }: CustomerChanges,
		actor: Actor,
	): Promise<boolean> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					if (!(await lockCustomer(tx, id))) {
						return false;
					}
					if (Object.keys(fields).length > 0) {
						await tx
							.update(customers)
							.set(fields)
							.where(eq(customers.id, id));
						await recordEvent(tx, id, "profile_updated", actor, {
							fields: Object.keys(fields),
						});
					}
					if (groupIds) {
						await setGroups(tx, id, groupIds, actor);
					}
					return true;
				}),
			customerConstraints,
		);
	}

	/** A registered customer. Throws 409 for an e-mail the store already has, even a guest's. */
	register(
		input: Omit<NewCustomer, "groupIds"> & { passwordHash: string },
	): Promise<CustomerId> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [{ id }] = await tx
						.insert(customers)
						.values({ ...input, tenantId: TenantContext.id() })
						.returning({ id: customers.id });
					await recordEvent(tx, id, "registered", null);
					return id;
				}),
			customerConstraints,
		);
	}

	/** Id and password hash (null for guests) of the customer with this e-mail. */
	async credentials(
		by: { email: Email } | { id: CustomerId },
	): Promise<{ id: CustomerId; passwordHash: string | null } | undefined> {
		const [row] = await this.tenantDb.run((tx) =>
			tx
				.select({
					id: customers.id,
					passwordHash: customers.passwordHash,
				})
				.from(customers)
				.where(
					"email" in by
						? eq(customers.email, by.email)
						: eq(customers.id, by.id),
				),
		);
		return row;
	}

	/** A new password, chosen by the buyer. */
	async setPasswordHash(id: CustomerId, passwordHash: string): Promise<void> {
		await this.tenantDb.run(async (tx) => {
			await tx
				.update(customers)
				.set({ passwordHash })
				.where(eq(customers.id, id));
			await recordEvent(tx, id, "password_changed", null);
		});
	}

	/** false when the tenant has no such customer. */
	addAddress(
		customerId: CustomerId,
		input: NewAddress,
		actor: Actor,
	): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			if (!(await lockCustomer(tx, customerId))) {
				return false;
			}
			const [{ id }] = await tx
				.insert(customerAddresses)
				.values({
					...(await addressColumns(tx, customerId, input)),
					tenantId: TenantContext.id(),
					customerId,
				} as typeof customerAddresses.$inferInsert)
				.returning({ id: customerAddresses.id });
			await recordEvent(tx, customerId, "address_added", actor, {
				addressId: id,
			});
			return true;
		});
	}

	/** false when the customer has no such address. */
	updateAddress(
		customerId: CustomerId,
		id: CustomerAddressId,
		changes: AddressChanges,
		actor: Actor,
	): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			if (!(await lockCustomer(tx, customerId))) {
				return false;
			}
			const rows = await tx
				.update(customerAddresses)
				.set(await addressColumns(tx, customerId, changes))
				.where(
					and(
						eq(customerAddresses.id, id),
						eq(customerAddresses.customerId, customerId),
					),
				)
				.returning({ id: customerAddresses.id });
			if (rows.length === 0) {
				return false;
			}
			await recordEvent(tx, customerId, "address_updated", actor, {
				addressId: id,
				fields: Object.keys(changes),
			});
			return true;
		});
	}

	/** false when the customer has no such address. */
	removeAddress(
		customerId: CustomerId,
		id: CustomerAddressId,
		actor: Actor,
	): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			const rows = await tx
				.delete(customerAddresses)
				.where(
					and(
						eq(customerAddresses.id, id),
						eq(customerAddresses.customerId, customerId),
					),
				)
				.returning({ id: customerAddresses.id });
			if (rows.length === 0) {
				return false;
			}
			await recordEvent(tx, customerId, "address_removed", actor, {
				addressId: id,
			});
			return true;
		});
	}

	/** Everything the store keeps about the customer; undefined when it has no such customer. */
	async export(id: CustomerId): Promise<CustomerExportDto | undefined> {
		const customer = await this.find(id);
		if (!customer) {
			return undefined;
		}
		const { addresses, groups, ...profile } = customer;
		return this.tenantDb.run(async (tx) => {
			const [{ updatedAt }] = await tx
				.select({ updatedAt: customers.updatedAt })
				.from(customers)
				.where(eq(customers.id, id));
			return {
				exportedAt: new Date(),
				customer: { ...profile, updatedAt },
				addresses,
				groups,
				history: (await history(tx, id)).items,
				orders: await customerOrders(tx, id),
			};
		});
	}

	/**
	 * Deletes the customer with their addresses, groups, history and carts;
	 * their other orders stay, without the customer and their addresses.
	 * false when the tenant has no such customer; 409 while an order is still
	 * to be paid or delivered.
	 */
	erase(id: CustomerId): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			if (!(await lockCustomer(tx, id))) {
				return false;
			}
			await releaseCustomerOrders(tx, id);
			await tx.delete(customers).where(eq(customers.id, id));
			return true;
		});
	}

	/** Newest first; undefined when the tenant has no such customer. */
	history(
		id: CustomerId,
		page: Page,
	): Promise<{ items: CustomerEventDto[]; total: number } | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [customer] = await tx
				.select({ id: customers.id })
				.from(customers)
				.where(eq(customers.id, id));
			return customer && history(tx, id, page);
		});
	}

	/** A note by the store's staff; undefined when the tenant has no such customer. */
	addNote(
		id: CustomerId,
		note: string,
		actor: Actor,
	): Promise<CustomerEventDto | undefined> {
		return this.tenantDb.run(async (tx) =>
			(await lockCustomer(tx, id))
				? recordEvent(tx, id, "note", actor, { note })
				: undefined,
		);
	}
}
