import {
	BadRequestException,
	ConflictException,
	Injectable,
} from "@nestjs/common";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { freeSlug } from "../catalog/free-slug.js";
import { translateConstraints } from "../database/pg-error.js";
import { assets } from "../database/schemas/assets.js";
import { facetValues } from "../database/schemas/facet-values.js";
import { facets } from "../database/schemas/facets.js";
import { productFacetValues } from "../database/schemas/product-facet-values.js";
import { productImages } from "../database/schemas/product-images.js";
import { productOptionGroups } from "../database/schemas/product-option-groups.js";
import { productOptions } from "../database/schemas/product-options.js";
import { productVariantOptions } from "../database/schemas/product-variant-options.js";
import { productVariants } from "../database/schemas/product-variants.js";
import { products } from "../database/schemas/products.js";
import type { ProductId } from "../domain/ids.js";
import type { Slug } from "../domain/slug.js";
import { FileStorage } from "../storage/file-storage.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type { ProductDto } from "./product.dto.js";
import type { NewProduct, ProductChanges } from "./product-input.js";

/** Constraint violations shared by the product and variant writes. */
export const productConstraints = {
	products_tenant_slug_unique: () =>
		new ConflictException("The store already has a product with this slug"),
	product_variants_tenant_sku_unique: () =>
		new ConflictException("The store already has a variant with this SKU"),
	product_images_asset_fk: () =>
		new BadRequestException("imageIds has an unknown asset"),
	product_variants_asset_fk: () =>
		new BadRequestException("imageId is an unknown asset"),
	product_facet_values_value_fk: () =>
		new BadRequestException("facetValueIds has an unknown facet value"),
};

/**
 * Locks the product for the rest of the transaction: every change to its
 * structure (options, variants) goes one at a time, so checks such as "not
 * the last variant" or "no other variant with these options" hold. false when
 * the tenant has no such product.
 */
export async function lockProduct(
	tx: TenantTransaction,
	id: ProductId,
): Promise<boolean> {
	const rows = await tx
		.select({ id: products.id })
		.from(products)
		.where(eq(products.id, id))
		.for("update");
	return rows.length > 0;
}

/** The current tenant's products, as the panel edits them and the stores show them. */
@Injectable()
export class ProductsRepository {
	constructor(
		private readonly tenantDb: TenantDatabase,
		private readonly storage: FileStorage,
	) {}

	find(id: ProductId): Promise<ProductDto | undefined> {
		return this.detail(eq(products.id, id));
	}

	/** An active product by slug, as the stores see it. */
	findActiveBySlug(slug: Slug): Promise<ProductDto | undefined> {
		return this.detail(
			and(eq(products.slug, slug), eq(products.status, "active")),
		);
	}

	async create(input: NewProduct): Promise<ProductId> {
		const tenantId = TenantContext.id();
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const slug = input.slugFromName
						? await freeSlug(tx, products, input.slug)
						: input.slug;
					const [product] = await tx
						.insert(products)
						.values({
							tenantId,
							name: input.name,
							slug,
							description: input.description,
							seoTitle: input.seoTitle,
							seoDescription: input.seoDescription,
						})
						.returning({ id: products.id });
					await tx.insert(productVariants).values({
						tenantId,
						productId: product.id,
						...input.variant,
						position: 0,
					});
					return product.id;
				}),
			productConstraints,
		);
	}

	/** false when the tenant has no such product. */
	async update(id: ProductId, changes: ProductChanges): Promise<boolean> {
		const tenantId = TenantContext.id();
		const { imageIds, facetValueIds, ...fields } = changes;
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					if (!(await lockProduct(tx, id))) {
						return false;
					}
					if (Object.keys(fields).length > 0) {
						await tx
							.update(products)
							.set(fields)
							.where(eq(products.id, id));
					}
					if (imageIds) {
						await tx
							.delete(productImages)
							.where(eq(productImages.productId, id));
						if (imageIds.length > 0) {
							await tx.insert(productImages).values(
								imageIds.map((assetId, position) => ({
									tenantId,
									productId: id,
									assetId,
									position,
								})),
							);
						}
					}
					if (facetValueIds) {
						await tx
							.delete(productFacetValues)
							.where(eq(productFacetValues.productId, id));
						if (facetValueIds.length > 0) {
							await tx.insert(productFacetValues).values(
								facetValueIds.map((facetValueId) => ({
									tenantId,
									productId: id,
									facetValueId,
								})),
							);
						}
					}
					return true;
				}),
			productConstraints,
		);
	}

	private async detail(
		where: SQL | undefined,
	): Promise<ProductDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [product] = await tx
				.select({
					id: products.id,
					name: products.name,
					slug: products.slug,
					description: products.description,
					status: products.status,
					seoTitle: products.seoTitle,
					seoDescription: products.seoDescription,
				})
				.from(products)
				.where(where)
				.limit(1);
			if (!product) {
				return undefined;
			}
			const id = product.id;
			const [images, groups, options, variants, variantOptions, values] =
				await Promise.all([
					tx
						.select({ id: assets.id, key: assets.key })
						.from(productImages)
						.innerJoin(assets, eq(assets.id, productImages.assetId))
						.where(eq(productImages.productId, id))
						.orderBy(asc(productImages.position)),
					tx
						.select({
							id: productOptionGroups.id,
							name: productOptionGroups.name,
						})
						.from(productOptionGroups)
						.where(eq(productOptionGroups.productId, id))
						.orderBy(asc(productOptionGroups.position)),
					tx
						.select({
							id: productOptions.id,
							name: productOptions.name,
							groupId: productOptions.groupId,
						})
						.from(productOptions)
						.where(eq(productOptions.productId, id))
						.orderBy(asc(productOptions.position)),
					tx
						.select({
							id: productVariants.id,
							sku: productVariants.sku,
							price: productVariants.price,
							assetId: assets.id,
							key: assets.key,
						})
						.from(productVariants)
						.leftJoin(
							assets,
							eq(assets.id, productVariants.assetId),
						)
						.where(eq(productVariants.productId, id))
						.orderBy(asc(productVariants.position)),
					tx
						.select({
							variantId: productVariantOptions.variantId,
							groupId: productVariantOptions.groupId,
							optionId: productVariantOptions.optionId,
						})
						.from(productVariantOptions)
						.where(eq(productVariantOptions.productId, id)),
					tx
						.select({
							id: facetValues.id,
							name: facetValues.name,
							facetId: facets.id,
							facetName: facets.name,
						})
						.from(productFacetValues)
						.innerJoin(
							facetValues,
							eq(facetValues.id, productFacetValues.facetValueId),
						)
						.innerJoin(facets, eq(facets.id, facetValues.facetId))
						.where(eq(productFacetValues.productId, id))
						.orderBy(
							asc(facets.createdAt),
							asc(facets.id),
							asc(facetValues.position),
						),
				]);
			const groupOrder = groups.map((group) => group.id);
			return {
				...product,
				images: images.map((image) => ({
					id: image.id,
					url: this.storage.publicUrl(image.key),
				})),
				optionGroups: groups.map((group) => ({
					...group,
					options: options
						.filter((option) => option.groupId === group.id)
						.map(({ id, name }) => ({ id, name })),
				})),
				variants: variants.map((variant) => ({
					id: variant.id,
					sku: variant.sku,
					price: variant.price,
					image:
						variant.assetId && variant.key
							? {
									id: variant.assetId,
									url: this.storage.publicUrl(variant.key),
								}
							: null,
					optionIds: variantOptions
						.filter((option) => option.variantId === variant.id)
						.sort(
							(a, b) =>
								groupOrder.indexOf(a.groupId) -
								groupOrder.indexOf(b.groupId),
						)
						.map((option) => option.optionId),
				})),
				facetValues: values,
			};
		});
	}
}
