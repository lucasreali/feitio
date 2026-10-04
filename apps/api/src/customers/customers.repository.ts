import { ConflictException, Injectable } from "@nestjs/common";
import {
	and,
	asc,
	count,
	desc,
	eq,
	ilike,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { customerAddresses } from "../database/schemas/customer-addresses.js";
import { customers } from "../database/schemas/customers.js";
import type { CustomerAddressId, CustomerId } from "../domain/ids.js";
import type { Page } from "../http/page.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type {
	AddressDto,
	CustomerDto,
	CustomerSummaryDto,
} from "./customer.dto.js";
import type {
	AddressChanges,
	CustomerChanges,
	NewAddress,
	NewCustomer,
} from "./customer-input.js";

const emailTaken = {
	customers_tenant_email_unique: () =>
		new ConflictException(
			"The store already has a customer with this e-mail",
		),
};

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
const contains = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

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
		search?: string,
	): Promise<{ items: CustomerSummaryDto[]; total: number }> {
		const where: SQL | undefined = search
			? or(
					ilike(customers.name, contains(search)),
					ilike(customers.email, contains(search)),
				)
			: undefined;
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
			return { ...customer, addresses };
		});
	}

	/** A customer without an account. Throws 409 for an e-mail in use. */
	create(input: NewCustomer): Promise<CustomerId> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [{ id }] = await tx
						.insert(customers)
						.values({ ...input, tenantId: TenantContext.id() })
						.returning({ id: customers.id });
					return id;
				}),
			emailTaken,
		);
	}

	/** false when the tenant has no such customer; 409 for an e-mail in use. */
	update(id: CustomerId, changes: CustomerChanges): Promise<boolean> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const rows = await tx
						.update(customers)
						.set(changes)
						.where(eq(customers.id, id))
						.returning({ id: customers.id });
					return rows.length > 0;
				}),
			emailTaken,
		);
	}

	/** false when the tenant has no such customer. */
	addAddress(customerId: CustomerId, input: NewAddress): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			if (!(await lockCustomer(tx, customerId))) {
				return false;
			}
			await tx.insert(customerAddresses).values({
				...(await addressColumns(tx, customerId, input)),
				tenantId: TenantContext.id(),
				customerId,
			} as typeof customerAddresses.$inferInsert);
			return true;
		});
	}

	/** false when the customer has no such address. */
	updateAddress(
		customerId: CustomerId,
		id: CustomerAddressId,
		changes: AddressChanges,
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
			return rows.length > 0;
		});
	}

	/** false when the customer has no such address. */
	removeAddress(
		customerId: CustomerId,
		id: CustomerAddressId,
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
			return rows.length > 0;
		});
	}
}
