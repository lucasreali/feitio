import { ConflictException, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { productVariants } from "../database/schemas/product-variants.js";
import { stockLevels } from "../database/schemas/stock-levels.js";
import { stockLocations } from "../database/schemas/stock-locations.js";
import {
	type StockMovementKind,
	stockMovements,
} from "../database/schemas/stock-movements.js";
import type { ProductVariantId, StockLocationId } from "../domain/ids.js";
import { publishEvent } from "../events/publish-event.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";

/** Units of a variant to move: from 1, or any non-zero number for an adjustment. */
export interface StockLine {
	variantId: ProductVariantId;
	quantity: number;
}

/** What each kind of movement does to `available` and `reserved`, per unit. */
const effects: Record<
	StockMovementKind,
	{ available: number; reserved: number }
> = {
	adjustment: { available: 1, reserved: 0 },
	reservation: { available: -1, reserved: 1 },
	sale: { available: 0, reserved: -1 },
	release: { available: 1, reserved: -1 },
	return: { available: 1, reserved: 0 },
};

/** The store's default location, created with its first stock write. */
async function defaultLocation(
	tx: TenantTransaction,
): Promise<StockLocationId> {
	await tx
		.insert(stockLocations)
		.values({ tenantId: TenantContext.id(), name: "Main", isDefault: true })
		.onConflictDoNothing({
			target: stockLocations.tenantId,
			where: sql`${stockLocations.isDefault}`,
		});
	const [location] = await tx
		.select({ id: stockLocations.id })
		.from(stockLocations)
		.where(eq(stockLocations.isDefault, true));
	return location.id;
}

/**
 * Moves stock in the default location and records each movement, all within
 * the caller's transaction, so an order can reserve with its own writes.
 * Lines go in variant id order, so concurrent calls lock levels in the same
 * order and cannot deadlock.
 *
 * Each level changes in a single conditional UPDATE, which PostgreSQL
 * re-checks after waiting for a concurrent one: two orders can never both
 * take the last unit. A change that would take `available` below zero (unless
 * a reservation of a variant that allows backorders) or `reserved` below zero
 * is refused with 409, and the transaction should roll back. Order movements
 * of variants that do not track stock change nothing; adjustments always
 * apply. 404 for a variant the store does not have. Publishes one
 * `stock.changed` event with the lines that moved, if any did.
 */
export async function moveStock(
	tx: TenantTransaction,
	kind: StockMovementKind,
	lines: StockLine[],
): Promise<void> {
	if (lines.length === 0) {
		return;
	}
	const tenantId = TenantContext.id();
	const variants = await tx
		.select({
			id: productVariants.id,
			trackStock: productVariants.trackStock,
			allowBackorder: productVariants.allowBackorder,
		})
		.from(productVariants)
		.where(
			inArray(
				productVariants.id,
				lines.map((line) => line.variantId),
			),
		);
	const policy = new Map(variants.map((variant) => [variant.id, variant]));
	const locationId = await defaultLocation(tx);
	const sorted = [...lines].sort((a, b) =>
		a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
	);
	const moved: StockLine[] = [];
	for (const { variantId, quantity } of sorted) {
		const variant = policy.get(variantId);
		if (!variant) {
			throw new NotFoundException(`Variant ${variantId} not found`);
		}
		if (kind !== "adjustment" && !variant.trackStock) {
			continue;
		}
		const available = effects[kind].available * quantity;
		const reserved = effects[kind].reserved * quantity;
		const backorder = kind === "reservation" && variant.allowBackorder;
		await tx
			.insert(stockLevels)
			.values({ tenantId, locationId, variantId })
			.onConflictDoNothing();
		const changed = await tx
			.update(stockLevels)
			.set({
				available: sql`${stockLevels.available} + ${available}`,
				reserved: sql`${stockLevels.reserved} + ${reserved}`,
			})
			.where(
				and(
					eq(stockLevels.locationId, locationId),
					eq(stockLevels.variantId, variantId),
					sql`${stockLevels.reserved} + ${reserved} >= 0`,
					backorder || available >= 0
						? undefined
						: sql`${stockLevels.available} + ${available} >= 0`,
				),
			)
			.returning({ variantId: stockLevels.variantId });
		if (changed.length === 0) {
			throw new ConflictException(
				kind === "sale" || kind === "release"
					? `Variant ${variantId} has fewer units reserved`
					: `Variant ${variantId} has not enough stock`,
			);
		}
		await tx
			.insert(stockMovements)
			.values({ tenantId, locationId, variantId, kind, quantity });
		moved.push({ variantId, quantity });
	}
	if (moved.length > 0) {
		await publishEvent(tx, { type: "stock.changed", kind, lines: moved });
	}
}
