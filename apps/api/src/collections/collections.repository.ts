import {
	BadRequestException,
	ConflictException,
	Injectable,
} from "@nestjs/common";
import { asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { freeSlug } from "../catalog/free-slug.js";
import { translateConstraints } from "../database/pg-error.js";
import { collectionFacetValues } from "../database/schemas/collection-facet-values.js";
import { collectionProducts } from "../database/schemas/collection-products.js";
import { collections } from "../database/schemas/collections.js";
import { facetValues } from "../database/schemas/facet-values.js";
import { facets } from "../database/schemas/facets.js";
import type { CollectionId, FacetValueId, ProductId } from "../domain/ids.js";
import type { Slug } from "../domain/slug.js";
import { invalid } from "../http/request-body.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type { CollectionDto, CollectionSummaryDto } from "./collection.dto.js";
import type { CollectionChanges, NewCollection } from "./collection-input.js";

const constraints = {
	collections_tenant_slug_unique: () =>
		new ConflictException(
			"The store already has a collection with this slug",
		),
	collections_parent_fk: () =>
		new BadRequestException("parentId is an unknown collection"),
	collection_facet_values_value_fk: () =>
		new BadRequestException("facetValueIds has an unknown facet value"),
	collection_products_product_fk: () =>
		new BadRequestException("productIds has an unknown product"),
};
const hasChildren = {
	collections_parent_fk: () =>
		new ConflictException(
			"The collection has child collections; move or remove them first",
		),
};

const summary = {
	id: collections.id,
	name: collections.name,
	slug: collections.slug,
	kind: collections.kind,
	parentId: collections.parentId,
	position: collections.position,
};

const sameParent = (parentId: CollectionId | null): SQL =>
	parentId
		? eq(collections.parentId, parentId)
		: isNull(collections.parentId);

/**
 * Serializes changes to the tenant's collection tree (positions, parents)
 * for the rest of the transaction. There may be no row to lock (the top
 * level has no parent row), so it is a transaction advisory lock per tenant.
 */
const lockTree = (tx: TenantTransaction) =>
	tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`collections:${TenantContext.id()}`}, 0))`,
	);

const nextPosition = async (
	tx: TenantTransaction,
	parentId: CollectionId | null,
) => {
	const [{ next }] = await tx
		.select({
			next: sql<number>`coalesce(max(${collections.position}) + 1, 0)::int`,
		})
		.from(collections)
		.where(sameParent(parentId));
	return next;
};

/** The current tenant's collections. */
@Injectable()
export class CollectionsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** Every collection: top level first, then by parent, each level in order. */
	list(): Promise<CollectionSummaryDto[]> {
		return this.tenantDb.run((tx) =>
			tx
				.select(summary)
				.from(collections)
				.orderBy(
					sql`${collections.parentId} nulls first`,
					asc(collections.position),
				),
		);
	}

	find(id: CollectionId): Promise<CollectionDto | undefined> {
		return this.detail(eq(collections.id, id));
	}

	findBySlug(slug: Slug): Promise<CollectionDto | undefined> {
		return this.detail(eq(collections.slug, slug));
	}

	/** Adds the collection after its siblings. */
	create(input: NewCollection): Promise<CollectionId> {
		const tenantId = TenantContext.id();
		return this.write(async (tx) => {
			await lockTree(tx);
			const { slugFromName, facetValueIds, ...fields } = input;
			const [collection] = await tx
				.insert(collections)
				.values({
					...fields,
					tenantId,
					slug: slugFromName
						? await freeSlug(tx, collections, input.slug)
						: input.slug,
					position: await nextPosition(tx, input.parentId),
				})
				.returning({ id: collections.id });
			await this.setRule(tx, collection.id, facetValueIds);
			return collection.id;
		});
	}

	/** false when the tenant has no such collection. */
	update(id: CollectionId, changes: CollectionChanges): Promise<boolean> {
		return this.write(async (tx) => {
			await lockTree(tx);
			const [current] = await tx
				.select({
					kind: collections.kind,
					parentId: collections.parentId,
				})
				.from(collections)
				.where(eq(collections.id, id));
			if (!current) {
				return false;
			}
			const { facetValueIds, ...fields } = changes;
			if (facetValueIds && current.kind !== "rule") {
				invalid(
					"Manual collections have no facet values; set their products instead",
				);
			}
			const moved =
				changes.parentId !== undefined &&
				changes.parentId !== current.parentId;
			if (
				moved &&
				changes.parentId &&
				(await this.isWithin(tx, changes.parentId, id))
			) {
				invalid(
					"A collection cannot go under itself or one of its children",
				);
			}
			await tx
				.update(collections)
				.set(
					moved
						? {
								...fields,
								position: await nextPosition(
									tx,
									changes.parentId ?? null,
								),
							}
						: fields,
				)
				.where(eq(collections.id, id));
			if (facetValueIds) {
				await tx
					.delete(collectionFacetValues)
					.where(eq(collectionFacetValues.collectionId, id));
				await this.setRule(tx, id, facetValueIds);
			}
			return true;
		});
	}

	/** false when the tenant has no such collection. Refused while it has children. */
	async remove(id: CollectionId): Promise<boolean> {
		const rows = await translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					await lockTree(tx);
					return tx
						.delete(collections)
						.where(eq(collections.id, id))
						.returning({ id: collections.id });
				}),
			hasChildren,
		);
		return rows.length > 0;
	}

	/** Puts the children of `parentId` in the order of `ids`, which must list them all. */
	reorder(parentId: CollectionId | null, ids: CollectionId[]): Promise<void> {
		return this.write(async (tx) => {
			await lockTree(tx);
			const siblings = await tx
				.select({ id: collections.id })
				.from(collections)
				.where(sameParent(parentId));
			if (
				siblings.length !== ids.length ||
				siblings.some((sibling) => !ids.includes(sibling.id))
			) {
				invalid(
					"collectionIds must list every collection under the parent, once",
				);
			}
			await tx.execute(sql`
				update collections c set position = o.position - 1
				from unnest(${`{${ids.join(",")}}`}::uuid[]) with ordinality as o(id, position)
				where c.id = o.id`);
		});
	}

	/** false when the tenant has no such collection. Refused for rule collections. */
	setProducts(id: CollectionId, productIds: ProductId[]): Promise<boolean> {
		const tenantId = TenantContext.id();
		return this.write(async (tx) => {
			const [collection] = await tx
				.select({ kind: collections.kind })
				.from(collections)
				.where(eq(collections.id, id))
				.for("update");
			if (!collection) {
				return false;
			}
			if (collection.kind !== "manual") {
				throw new ConflictException(
					"A rule collection takes its products from its facet values",
				);
			}
			await tx
				.delete(collectionProducts)
				.where(eq(collectionProducts.collectionId, id));
			if (productIds.length > 0) {
				await tx.insert(collectionProducts).values(
					productIds.map((productId, position) => ({
						tenantId,
						collectionId: id,
						productId,
						position,
					})),
				);
			}
			return true;
		});
	}

	/** Whether `candidate` is `id` or one of its descendants. */
	private async isWithin(
		tx: TenantTransaction,
		candidate: CollectionId,
		id: CollectionId,
	) {
		const { rows } = await tx.execute(sql`
			with recursive ancestors as (
				select id, parent_id from collections where id = ${candidate}
				union
				select c.id, c.parent_id from collections c join ancestors a on c.id = a.parent_id
			)
			select 1 from ancestors where id = ${id}`);
		return rows.length > 0;
	}

	private async setRule(
		tx: TenantTransaction,
		id: CollectionId,
		facetValueIds: FacetValueId[],
	) {
		if (facetValueIds.length > 0) {
			const tenantId = TenantContext.id();
			await tx.insert(collectionFacetValues).values(
				facetValueIds.map((facetValueId) => ({
					tenantId,
					collectionId: id,
					facetValueId,
				})),
			);
		}
	}

	private async detail(where: SQL): Promise<CollectionDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [collection] = await tx
				.select({
					...summary,
					description: collections.description,
					seoTitle: collections.seoTitle,
					seoDescription: collections.seoDescription,
				})
				.from(collections)
				.where(where);
			if (!collection) {
				return undefined;
			}
			const [products, values] = await Promise.all([
				tx
					.select({ id: collectionProducts.productId })
					.from(collectionProducts)
					.where(eq(collectionProducts.collectionId, collection.id))
					.orderBy(asc(collectionProducts.position)),
				tx
					.select({ id: collectionFacetValues.facetValueId })
					.from(collectionFacetValues)
					.innerJoin(
						facetValues,
						eq(facetValues.id, collectionFacetValues.facetValueId),
					)
					.innerJoin(facets, eq(facets.id, facetValues.facetId))
					.where(
						eq(collectionFacetValues.collectionId, collection.id),
					)
					.orderBy(
						asc(facets.createdAt),
						asc(facets.id),
						asc(facetValues.position),
					),
			]);
			return {
				...collection,
				productIds: products.map((row) => row.id),
				facetValueIds: values.map((row) => row.id),
			};
		});
	}

	private write<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
		return translateConstraints(() => this.tenantDb.run(fn), constraints);
	}
}
