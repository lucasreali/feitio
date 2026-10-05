import type { StockMovementKind } from "../database/schemas/stock-movements.js";
import type { OrderId, ProductId } from "../domain/ids.js";
import type { OrderState } from "../orders/order-state.js";
import type { StockLine } from "../stock/stock-ledger.js";

/**
 * Something that happened in a store, for work outside the request (the
 * worker). Ids and numbers only, never personal data: handlers read what they
 * need from the database.
 */
export type DomainEvent =
	| { type: "product.created"; productId: ProductId }
	| { type: "stock.changed"; kind: StockMovementKind; lines: StockLine[] }
	| {
			type: "order.transitioned";
			orderId: OrderId;
			from: OrderState;
			to: OrderState;
	  };

export type DomainEventType = DomainEvent["type"];
