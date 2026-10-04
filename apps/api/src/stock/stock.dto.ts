import type { StockMovementKind } from "../database/schemas/stock-movements.js";

export class VariantStockDto {
	variantId: string;
	/** false: sold without counting stock. */
	trackStock: boolean;
	/** Sold past zero when stock is tracked. */
	allowBackorder: boolean;
	/** The panel warns at or below it; null: never. */
	lowStockThreshold: number | null;
	/** Units that can be sold; below zero only with backorders. */
	available: number;
	/** Units held by orders awaiting payment. */
	reserved: number;
	/** Tracked, with available units at or below the threshold. */
	low: boolean;
}

export class UpdateStockPolicyDto {
	trackStock?: boolean;
	allowBackorder?: boolean;
	/** A whole number from 0, or null to never warn. */
	lowStockThreshold?: number | null;
}

export class StockAdjustmentDto {
	/** Units to add, or to remove if negative; never 0. Available stock never goes below zero. */
	quantity: number;
}

export class StockMovementDto {
	id: string;
	/**
	 * `adjustment` (by the store), `reservation`, `sale`, `release` (reserved
	 * back to available) or `return`.
	 */
	kind: StockMovementKind;
	/** Units moved; only adjustments are negative (units removed). */
	quantity: number;
	createdAt: Date;
}

export class StockMovementPageDto {
	items: StockMovementDto[];
	page: number;
	pageSize: number;
	/** Movements in every page. */
	total: number;
}

export class LowStockDto {
	variantId: string;
	sku: string;
	productId: string;
	productName: string;
	available: number;
	reserved: number;
	lowStockThreshold: number;
}

export class LowStockPageDto {
	items: LowStockDto[];
	page: number;
	pageSize: number;
	/** Variants in every page. */
	total: number;
}
