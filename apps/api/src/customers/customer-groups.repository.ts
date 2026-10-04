import { ConflictException, Injectable } from "@nestjs/common";
import { asc, count, eq } from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { customerGroupMembers } from "../database/schemas/customer-group-members.js";
import { customerGroups } from "../database/schemas/customer-groups.js";
import type { CustomerGroupId } from "../domain/ids.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { CustomerGroupDto } from "./customer-group.dto.js";

const nameTaken = {
	customer_groups_tenant_name_unique: () =>
		new ConflictException("The store already has a group with this name"),
};

/** The current tenant's customer groups. */
@Injectable()
export class CustomerGroupsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** By name. */
	list(): Promise<CustomerGroupDto[]> {
		return this.tenantDb.run((tx) =>
			tx
				.select({
					id: customerGroups.id,
					name: customerGroups.name,
					customerCount: count(customerGroupMembers.customerId),
				})
				.from(customerGroups)
				.leftJoin(
					customerGroupMembers,
					eq(customerGroupMembers.groupId, customerGroups.id),
				)
				.groupBy(customerGroups.id)
				.orderBy(asc(customerGroups.name), asc(customerGroups.id)),
		);
	}

	async find(id: CustomerGroupId): Promise<CustomerGroupDto | undefined> {
		return (await this.list()).find((group) => group.id === id);
	}

	/** Throws 409 for a name in use. */
	create(name: string): Promise<CustomerGroupId> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [{ id }] = await tx
						.insert(customerGroups)
						.values({ tenantId: TenantContext.id(), name })
						.returning({ id: customerGroups.id });
					return id;
				}),
			nameTaken,
		);
	}

	/** false when the tenant has no such group; 409 for a name in use. */
	rename(id: CustomerGroupId, name: string): Promise<boolean> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const rows = await tx
						.update(customerGroups)
						.set({ name })
						.where(eq(customerGroups.id, id))
						.returning({ id: customerGroups.id });
					return rows.length > 0;
				}),
			nameTaken,
		);
	}

	/** Takes the group out of every customer. false when the tenant has no such group. */
	remove(id: CustomerGroupId): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			const rows = await tx
				.delete(customerGroups)
				.where(eq(customerGroups.id, id))
				.returning({ id: customerGroups.id });
			return rows.length > 0;
		});
	}
}
