import { asc, eq, sql } from "drizzle-orm";
import { orderLines } from "../database/schemas/order-lines.js";
import type { OrderId } from "../domain/ids.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { OrderLineDto } from "./order.dto.js";

/** An order's lines, in the order they were added. */
export function linesOf(
	tx: TenantTransaction,
	id: OrderId,
): Promise<OrderLineDto[]> {
	return tx
		.select({
			id: orderLines.id,
			variantId: orderLines.variantId,
			productName: orderLines.productName,
			sku: orderLines.sku,
			quantity: orderLines.quantity,
			unitPrice: orderLines.unitPrice,
			total: sql<number>`${orderLines.quantity} * ${orderLines.unitPrice}`,
		})
		.from(orderLines)
		.where(eq(orderLines.orderId, id))
		.orderBy(asc(orderLines.position));
}
