import { ConflictException, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import {
	FOREIGN_KEY_VIOLATION,
	translateConstraints,
	UNIQUE_VIOLATION,
} from "../database/pg-error.js";
import { facetValues } from "../database/schemas/facet-values.js";
import { facets } from "../database/schemas/facets.js";
import type { FacetId, FacetValueId } from "../domain/ids.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { FacetDto } from "./facet.dto.js";
import type { NewFacet } from "./facet-input.js";

const nameTaken = {
	[UNIQUE_VIOLATION]: () =>
		new ConflictException("That name is already in use"),
};
const usedByRule = {
	[FOREIGN_KEY_VIOLATION]: () =>
		new ConflictException(
			"A rule collection uses this value; change the rule first",
		),
};

/** The current tenant's facets and their values. */
@Injectable()
export class FacetsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** Every facet with its values, in the order they were created. */
	async list(): Promise<FacetDto[]> {
		const [facetRows, valueRows] = await this.tenantDb.run((tx) =>
			Promise.all([
				tx
					.select({ id: facets.id, name: facets.name })
					.from(facets)
					.orderBy(asc(facets.createdAt), asc(facets.id)),
				tx
					.select({
						id: facetValues.id,
						name: facetValues.name,
						facetId: facetValues.facetId,
					})
					.from(facetValues)
					.orderBy(asc(facetValues.position)),
			]),
		);
		return facetRows.map((facet) => ({
			...facet,
			values: valueRows
				.filter((value) => value.facetId === facet.id)
				.map(({ id, name }) => ({ id, name })),
		}));
	}

	async find(id: FacetId): Promise<FacetDto | undefined> {
		return (await this.list()).find((facet) => facet.id === id);
	}

	async create({ name, values }: NewFacet): Promise<FacetId> {
		const tenantId = TenantContext.id();
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [facet] = await tx
						.insert(facets)
						.values({ tenantId, name })
						.returning({ id: facets.id });
					if (values.length > 0) {
						await tx.insert(facetValues).values(
							values.map((value, position) => ({
								tenantId,
								facetId: facet.id,
								name: value,
								position,
							})),
						);
					}
					return facet.id;
				}),
			nameTaken,
		);
	}

	/** false when the tenant has no such facet. */
	async rename(id: FacetId, name: string): Promise<boolean> {
		const rows = await translateConstraints(
			() =>
				this.tenantDb.run((tx) =>
					tx
						.update(facets)
						.set({ name })
						.where(eq(facets.id, id))
						.returning({ id: facets.id }),
				),
			nameTaken,
		);
		return rows.length > 0;
	}

	/** Removes the facet and its values from every product; false when there is none. */
	async remove(id: FacetId): Promise<boolean> {
		const rows = await translateConstraints(
			() =>
				this.tenantDb.run((tx) =>
					tx
						.delete(facets)
						.where(eq(facets.id, id))
						.returning({ id: facets.id }),
				),
			usedByRule,
		);
		return rows.length > 0;
	}

	/** false when the tenant has no such facet. */
	async addValue(facetId: FacetId, name: string): Promise<boolean> {
		const tenantId = TenantContext.id();
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					// Locks the facet, so values added at once get distinct positions.
					const [facet] = await tx
						.select({ id: facets.id })
						.from(facets)
						.where(eq(facets.id, facetId))
						.for("update");
					if (!facet) {
						return false;
					}
					const [{ next }] = await tx
						.select({
							next: sql<number>`coalesce(max(${facetValues.position}) + 1, 0)::int`,
						})
						.from(facetValues)
						.where(eq(facetValues.facetId, facetId));
					await tx
						.insert(facetValues)
						.values({ tenantId, facetId, name, position: next });
					return true;
				}),
			nameTaken,
		);
	}

	/** The value's facet, or undefined when the tenant has no such value. */
	async renameValue(
		id: FacetValueId,
		name: string,
	): Promise<FacetId | undefined> {
		const [row] = await translateConstraints(
			() =>
				this.tenantDb.run((tx) =>
					tx
						.update(facetValues)
						.set({ name })
						.where(eq(facetValues.id, id))
						.returning({ facetId: facetValues.facetId }),
				),
			nameTaken,
		);
		return row?.facetId;
	}

	/** Takes the value off its products. The value's facet, or undefined when there is none. */
	async removeValue(id: FacetValueId): Promise<FacetId | undefined> {
		const [row] = await translateConstraints(
			() =>
				this.tenantDb.run((tx) =>
					tx
						.delete(facetValues)
						.where(eq(facetValues.id, id))
						.returning({ facetId: facetValues.facetId }),
				),
			usedByRule,
		);
		return row?.facetId;
	}
}
