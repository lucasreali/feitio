import { Injectable } from "@nestjs/common";
import { asc, count, desc, eq, ne, sql } from "drizzle-orm";
import { productVariants } from "../database/schemas/product-variants.js";
import { products } from "../database/schemas/products.js";
import { stockLevels } from "../database/schemas/stock-levels.js";
import { stockMovements } from "../database/schemas/stock-movements.js";
import type { ProductVariantId } from "../domain/ids.js";
import type { Page } from "../http/page.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type {
	LowStockDto,
	StockMovementDto,
	VariantStockDto,
} from "./stock.dto.js";
import type { StockPolicyChanges } from "./stock-input.js";
import { moveStock } from "./stock-ledger.js";

/** A variant's units across locations; nothing when it has no level yet. */
const available = sql<number>`coalesce(sum(${stockLevels.available}), 0)::int`;
const reserved = sql<number>`coalesce(sum(${stockLevels.reserved}), 0)::int`;
const low = sql<boolean>`coalesce(${productVariants.trackStock} and ${available} <= ${productVariants.lowStockThreshold}, false)`;

/** Stock of the current tenant's variants, as the panel sees and adjusts it. */
@Injectable()
export class StockRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	async find(id: ProductVariantId): Promise<VariantStockDto | undefined> {
		const [row] = await this.tenantDb.run((tx) =>
			tx
				.select({
					variantId: productVariants.id,
					trackStock: productVariants.trackStock,
					allowBackorder: productVariants.allowBackorder,
					lowStockThreshold: productVariants.lowStockThreshold,
					available,
					reserved,
					low,
				})
				.from(productVariants)
				.leftJoin(
					stockLevels,
					eq(stockLevels.variantId, productVariants.id),
				)
				.where(eq(productVariants.id, id))
				.groupBy(productVariants.id),
		);
		return row;
	}

	/** false when the tenant has no such variant. */
	async updatePolicy(
		id: ProductVariantId,
		changes: StockPolicyChanges,
	): Promise<boolean> {
		const rows = await this.tenantDb.run((tx) =>
			tx
				.update(productVariants)
				.set(changes)
				.where(eq(productVariants.id, id))
				.returning({ id: productVariants.id }),
		);
		return rows.length > 0;
	}

	/** Throws 404 for a variant the tenant does not have, 409 below zero. */
	adjust(id: ProductVariantId, quantity: number): Promise<void> {
		return this.tenantDb.run((tx) =>
			moveStock(tx, "adjustment", [{ variantId: id, quantity }]),
		);
	}

	/** Newest first; undefined when the tenant has no such variant. */
	movements(
		id: ProductVariantId,
		page: Page,
	): Promise<{ items: StockMovementDto[]; total: number } | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [variant] = await tx
				.select({ id: productVariants.id })
				.from(productVariants)
				.where(eq(productVariants.id, id));
			if (!variant) {
				return undefined;
			}
			const [items, [{ total }]] = await Promise.all([
				tx
					.select({
						id: stockMovements.id,
						kind: stockMovements.kind,
						quantity: stockMovements.quantity,
						createdAt: stockMovements.createdAt,
					})
					.from(stockMovements)
					.where(eq(stockMovements.variantId, id))
					.orderBy(
						desc(stockMovements.createdAt),
						desc(stockMovements.id),
					)
					.limit(page.pageSize)
					.offset(page.offset),
				tx
					.select({ total: count() })
					.from(stockMovements)
					.where(eq(stockMovements.variantId, id)),
			]);
			return { items, total };
		});
	}

	/** Variants of products that are not archived, at or below their threshold, fewest units first. */
	lowStock(page: Page): Promise<{ items: LowStockDto[]; total: number }> {
		return this.tenantDb.run(async (tx) => {
			const query = tx
				.select({
					variantId: productVariants.id,
					sku: productVariants.sku,
					productId: products.id,
					productName: products.name,
					available,
					reserved,
					lowStockThreshold: sql<number>`${productVariants.lowStockThreshold}`,
				})
				.from(productVariants)
				.innerJoin(products, eq(products.id, productVariants.productId))
				.leftJoin(
					stockLevels,
					eq(stockLevels.variantId, productVariants.id),
				)
				.where(ne(products.status, "archived"))
				.groupBy(productVariants.id, products.id)
				.having(low);
			const [items, [{ total }]] = await Promise.all([
				query
					.orderBy(asc(available), asc(productVariants.sku))
					.limit(page.pageSize)
					.offset(page.offset),
				tx.select({ total: count() }).from(query.as("low")),
			]);
			return { items, total };
		});
	}
}
