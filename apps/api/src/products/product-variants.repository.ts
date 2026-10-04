import { ConflictException, Injectable } from "@nestjs/common";
import { asc, count, countDistinct, eq, sql } from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { productOptionGroups } from "../database/schemas/product-option-groups.js";
import { productOptions } from "../database/schemas/product-options.js";
import { productVariantOptions } from "../database/schemas/product-variant-options.js";
import { productVariants } from "../database/schemas/product-variants.js";
import type {
	ProductId,
	ProductOptionGroupId,
	ProductOptionId,
	ProductVariantId,
} from "../domain/ids.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import type {
	NewOptionGroup,
	NewVariant,
	VariantChanges,
} from "./product-input.js";
import { lockProduct, productConstraints } from "./products.repository.js";
import { combinationOf, sameCombination } from "./variant-combination.js";

const constraints = {
	...productConstraints,
	product_option_groups_product_name_unique: () =>
		new ConflictException(
			"The product already has an option group with this name",
		),
	product_options_group_name_unique: () =>
		new ConflictException("The group already has an option with this name"),
	product_variant_options_option_fk: () =>
		new ConflictException("Variants use this option; remove them first"),
};

/** The next position after the rows of `table` that match `where`. */
const nextPosition = async (
	tx: TenantTransaction,
	table:
		| typeof productOptionGroups
		| typeof productOptions
		| typeof productVariants,
	where: ReturnType<typeof eq>,
) => {
	const [{ next }] = await tx
		.select({
			next: sql<number>`coalesce(max(${table.position}) + 1, 0)::int`,
		})
		.from(table)
		.where(where);
	return next;
};

/**
 * Option groups, options and variants of the current tenant's products. Every
 * write locks the product first (lockProduct), so its checks hold under
 * concurrent requests. Methods that find their row return its product's id,
 * or undefined when the tenant has no such row.
 */
@Injectable()
export class ProductVariantsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** A new group gives its first option to every variant the product has. */
	addOptionGroup(
		productId: ProductId,
		group: NewOptionGroup,
	): Promise<boolean> {
		const tenantId = TenantContext.id();
		return this.write(async (tx) => {
			if (!(await lockProduct(tx, productId))) {
				return false;
			}
			const [{ id: groupId }] = await tx
				.insert(productOptionGroups)
				.values({
					tenantId,
					productId,
					name: group.name,
					position: await nextPosition(
						tx,
						productOptionGroups,
						eq(productOptionGroups.productId, productId),
					),
				})
				.returning({ id: productOptionGroups.id });
			const [first] = await tx
				.insert(productOptions)
				.values(
					group.options.map((name, position) => ({
						tenantId,
						productId,
						groupId,
						name,
						position,
					})),
				)
				.returning({
					id: productOptions.id,
					position: productOptions.position,
				})
				.then((rows) => rows.sort((a, b) => a.position - b.position));
			const variants = await tx
				.select({ id: productVariants.id })
				.from(productVariants)
				.where(eq(productVariants.productId, productId));
			await tx.insert(productVariantOptions).values(
				variants.map((variant) => ({
					tenantId,
					productId,
					variantId: variant.id,
					groupId,
					optionId: first.id,
				})),
			);
			return true;
		});
	}

	renameOptionGroup(
		id: ProductOptionGroupId,
		name: string,
	): Promise<ProductId | undefined> {
		return this.write(async (tx) => {
			const [group] = await tx
				.update(productOptionGroups)
				.set({ name })
				.where(eq(productOptionGroups.id, id))
				.returning({ productId: productOptionGroups.productId });
			return group?.productId;
		});
	}

	/**
	 * Removes a group and its options from the product's variants. Refused
	 * while the variants differ in it: without the group they would collide.
	 */
	removeOptionGroup(
		id: ProductOptionGroupId,
	): Promise<ProductId | undefined> {
		return this.write(async (tx) => {
			const productId = await this.productOf(tx, productOptionGroups, id);
			if (!productId) {
				return undefined;
			}
			const [{ options }] = await tx
				.select({
					options: countDistinct(productVariantOptions.optionId),
				})
				.from(productVariantOptions)
				.where(eq(productVariantOptions.groupId, id));
			if (options > 1) {
				throw new ConflictException(
					"Variants differ in this group; remove them until one option is left",
				);
			}
			await tx
				.delete(productVariantOptions)
				.where(eq(productVariantOptions.groupId, id));
			await tx
				.delete(productOptionGroups)
				.where(eq(productOptionGroups.id, id));
			return productId;
		});
	}

	addOption(
		groupId: ProductOptionGroupId,
		name: string,
	): Promise<ProductId | undefined> {
		const tenantId = TenantContext.id();
		return this.write(async (tx) => {
			const productId = await this.productOf(
				tx,
				productOptionGroups,
				groupId,
			);
			if (!productId) {
				return undefined;
			}
			await tx.insert(productOptions).values({
				tenantId,
				productId,
				groupId,
				name,
				position: await nextPosition(
					tx,
					productOptions,
					eq(productOptions.groupId, groupId),
				),
			});
			return productId;
		});
	}

	renameOption(
		id: ProductOptionId,
		name: string,
	): Promise<ProductId | undefined> {
		return this.write(async (tx) => {
			const [option] = await tx
				.update(productOptions)
				.set({ name })
				.where(eq(productOptions.id, id))
				.returning({ productId: productOptions.productId });
			return option?.productId;
		});
	}

	/** Refused (by the foreign key) while a variant uses the option. */
	removeOption(id: ProductOptionId): Promise<ProductId | undefined> {
		return this.write(async (tx) => {
			const productId = await this.productOf(tx, productOptions, id);
			if (productId) {
				await tx
					.delete(productOptions)
					.where(eq(productOptions.id, id));
			}
			return productId;
		});
	}

	/** Refused when another variant of the product has the same options. */
	addVariant(productId: ProductId, variant: NewVariant): Promise<boolean> {
		const tenantId = TenantContext.id();
		return this.write(async (tx) => {
			if (!(await lockProduct(tx, productId))) {
				return false;
			}
			const [groups, options, taken] = await Promise.all([
				tx
					.select({ id: productOptionGroups.id })
					.from(productOptionGroups)
					.where(eq(productOptionGroups.productId, productId))
					.orderBy(asc(productOptionGroups.position)),
				tx
					.select({
						id: productOptions.id,
						groupId: productOptions.groupId,
					})
					.from(productOptions)
					.where(eq(productOptions.productId, productId)),
				tx
					.select({
						variantId: productVariants.id,
						optionIds: sql<
							ProductOptionId[]
						>`coalesce(array_agg(${productVariantOptions.optionId}) filter (where ${productVariantOptions.optionId} is not null), '{}')`,
					})
					.from(productVariants)
					.leftJoin(
						productVariantOptions,
						eq(productVariantOptions.variantId, productVariants.id),
					)
					.where(eq(productVariants.productId, productId))
					.groupBy(productVariants.id),
			]);
			const combination = combinationOf(
				groups.map((group) => ({
					id: group.id,
					optionIds: options
						.filter((option) => option.groupId === group.id)
						.map((option) => option.id),
				})),
				variant.optionIds,
			);
			if (
				taken.some((other) =>
					sameCombination(other.optionIds, variant.optionIds),
				)
			) {
				throw new ConflictException(
					"Another variant of the product has these options",
				);
			}
			const [{ id: variantId }] = await tx
				.insert(productVariants)
				.values({
					tenantId,
					productId,
					sku: variant.sku,
					price: variant.price,
					assetId: variant.imageId,
					position: await nextPosition(
						tx,
						productVariants,
						eq(productVariants.productId, productId),
					),
				})
				.returning({ id: productVariants.id });
			if (combination.length > 0) {
				await tx.insert(productVariantOptions).values(
					combination.map((pair) => ({
						tenantId,
						productId,
						variantId,
						...pair,
					})),
				);
			}
			return true;
		});
	}

	updateVariant(
		id: ProductVariantId,
		changes: VariantChanges,
	): Promise<ProductId | undefined> {
		const { imageId, ...fields } = changes;
		return this.write(async (tx) => {
			const [variant] = await tx
				.update(productVariants)
				.set(
					imageId === undefined
						? fields
						: { ...fields, assetId: imageId },
				)
				.where(eq(productVariants.id, id))
				.returning({ productId: productVariants.productId });
			return variant?.productId;
		});
	}

	/** Refused for the product's last variant. */
	removeVariant(id: ProductVariantId): Promise<ProductId | undefined> {
		return this.write(async (tx) => {
			const productId = await this.productOf(tx, productVariants, id);
			if (!productId) {
				return undefined;
			}
			const [{ variants }] = await tx
				.select({ variants: count() })
				.from(productVariants)
				.where(eq(productVariants.productId, productId));
			if (variants === 1) {
				throw new ConflictException(
					"A product keeps at least one variant; archive it instead",
				);
			}
			await tx.delete(productVariants).where(eq(productVariants.id, id));
			return productId;
		});
	}

	/** The product of a group, option or variant, locked; undefined when there is no such row. */
	private async productOf(
		tx: TenantTransaction,
		table:
			| typeof productOptionGroups
			| typeof productOptions
			| typeof productVariants,
		id: string,
	): Promise<ProductId | undefined> {
		const [row] = await tx
			.select({ productId: table.productId })
			.from(table)
			.where(sql`${table.id} = ${id}`);
		return row && (await lockProduct(tx, row.productId))
			? row.productId
			: undefined;
	}

	private write<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
		return translateConstraints(() => this.tenantDb.run(fn), constraints);
	}
}
