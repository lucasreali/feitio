import { asc, eq, sql } from "drizzle-orm";
import { orderLines } from "../database/schemas/order-lines.js";
import { orders } from "../database/schemas/orders.js";
import type { OrderId } from "../domain/ids.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import type { OrderLineDto, OrderShippingMethodDto } from "./order.dto.js";

/** The shipping the buyer chose, as orders show it; null before choosing. */
export const shippingMethodOf = sql<OrderShippingMethodDto | null>`case when ${orders.shippingMethodId} is null then null else json_build_object('id', ${orders.shippingMethodId}, 'name', ${orders.shippingMethodName}, 'deliveryDays', ${orders.shippingDeliveryDays}) end`;

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
