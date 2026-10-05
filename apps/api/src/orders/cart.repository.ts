import { ConflictException, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Guest } from "../customers/customer-input.js";
import { guestCustomer } from "../customers/customers.repository.js";
import { customers } from "../database/schemas/customers.js";
import { orderLines } from "../database/schemas/order-lines.js";
import { type OrderAddress, orders } from "../database/schemas/orders.js";
import { productVariants } from "../database/schemas/product-variants.js";
import { products } from "../database/schemas/products.js";
import { stockLevels } from "../database/schemas/stock-levels.js";
import type {
	CustomerId,
	OrderId,
	OrderLineId,
	ProductVariantId,
} from "../domain/ids.js";
import { invalid } from "../http/request-body.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import { MAX_QUANTITY } from "./cart-input.js";
import { newCartToken } from "./cart-token.js";
import type { CartDto, OrderLineDto } from "./order.dto.js";
import { transitionOrder } from "./order-transitions.js";

/** Variants the store sells: of active products. */
const sellable = and(
	eq(products.id, productVariants.productId),
	eq(products.status, "active"),
);

/**
 * Locks the order behind a token for the rest of the transaction, so
 * concurrent changes to one order run one at a time. undefined when the
 * store has no such order.
 */
async function lockOrder(tx: TenantTransaction, tokenHash: string) {
	const [order] = await tx
		.select({
			id: orders.id,
			state: orders.state,
			customerId: orders.customerId,
			shippingAddress: orders.shippingAddress,
		})
		.from(orders)
		.where(eq(orders.tokenHash, tokenHash))
		.for("update");
	return order;
}

/** lockOrder, and 409 when the order is no longer a cart. */
async function lockCart(
	tx: TenantTransaction,
	tokenHash: string,
): Promise<OrderId | undefined> {
	const order = await lockOrder(tx, tokenHash);
	if (order && order.state !== "cart") {
		throw new ConflictException(
			"The order has been placed; only a cart can change",
		);
	}
	return order?.id;
}

/**
 * 409 when the store cannot sell `quantity` units of a tracked variant that
 * does not sell past zero. Placing the order reserves them, and checks again.
 */
async function ensureStock(
	tx: TenantTransaction,
	variantId: ProductVariantId,
	quantity: number,
) {
	const [variant] = await tx
		.select({
			limited: sql<boolean>`${productVariants.trackStock} and not ${productVariants.allowBackorder}`,
			available: sql<number>`coalesce((select sum(${stockLevels.available}) from ${stockLevels} where ${stockLevels.variantId} = ${productVariants.id}), 0)::int`,
		})
		.from(productVariants)
		.where(eq(productVariants.id, variantId));
	if (variant?.limited && quantity > variant.available) {
		throw new ConflictException(
			`Only ${Math.max(variant.available, 0)} units in stock`,
		);
	}
}

/**
 * Brings a cart up to date with the catalog: drops lines the store no longer
 * sells, copies current prices, names and SKUs, and sums the totals. Runs
 * after every change, so the price is always the API's.
 */
async function reprice(tx: TenantTransaction, id: OrderId) {
	await tx
		.delete(orderLines)
		.where(
			and(
				eq(orderLines.orderId, id),
				sql`not exists (select 1 from ${productVariants} join ${products} on ${sellable} where ${productVariants.id} = ${orderLines.variantId})`,
			),
		);
	await tx
		.update(orderLines)
		.set({
			unitPrice: sql`${productVariants.price}`,
			sku: sql`${productVariants.sku}`,
			productName: sql`${products.name}`,
		})
		.from(productVariants)
		.innerJoin(products, eq(products.id, productVariants.productId))
		.where(
			and(
				eq(orderLines.orderId, id),
				eq(productVariants.id, orderLines.variantId),
			),
		);
	const subtotal = sql`(select coalesce(sum(${orderLines.quantity} * ${orderLines.unitPrice}), 0) from ${orderLines} where ${orderLines.orderId} = ${id})`;
	await tx
		.update(orders)
		.set({
			subtotal: sql`${subtotal}`,
			total: sql`${subtotal} - ${orders.discount} + ${orders.shipping}`,
		})
		.where(eq(orders.id, id));
}

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

/** The order as the store shows it. */
export async function cartView(
	tx: TenantTransaction,
	id: OrderId,
): Promise<CartDto> {
	const [order] = await tx
		.select({
			state: orders.state,
			number: orders.number,
			email: customers.email,
			shippingAddress: orders.shippingAddress,
			billingAddress: orders.billingAddress,
			subtotal: orders.subtotal,
			discount: orders.discount,
			shipping: orders.shipping,
			total: orders.total,
		})
		.from(orders)
		.leftJoin(customers, eq(customers.id, orders.customerId))
		.where(eq(orders.id, id));
	const lines = await linesOf(tx, id);
	const { state, number, email, shippingAddress, billingAddress, ...totals } =
		order;
	return {
		state,
		number,
		// Only the e-mail: a guest's e-mail can be typed by anyone.
		customer: email ? { email } : null,
		shippingAddress,
		billingAddress,
		lines,
		...totals,
	};
}

/**
 * The stores' carts, found by the SHA-256 of their token. Every method
 * answers undefined when the store has no order with that token.
 */
@Injectable()
export class CartRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** An empty cart, and its token. */
	create(): Promise<{ token: string; cart: CartDto }> {
		const { token, hash } = newCartToken();
		return this.tenantDb.run(async (tx) => {
			const [{ id }] = await tx
				.insert(orders)
				.values({ tenantId: TenantContext.id(), tokenHash: hash })
				.returning({ id: orders.id });
			return { token, cart: await cartView(tx, id) };
		});
	}

	find(tokenHash: string): Promise<CartDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id })
				.from(orders)
				.where(eq(orders.tokenHash, tokenHash));
			return order && cartView(tx, order.id);
		});
	}

	/**
	 * Adds units of a variant, to its line if the cart has one. 400 for a
	 * variant the store does not sell, 409 past the units in stock.
	 */
	addLine(
		tokenHash: string,
		variantId: ProductVariantId,
		quantity: number,
	): Promise<CartDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const id = await lockCart(tx, tokenHash);
			if (!id) {
				return undefined;
			}
			const [variant] = await tx
				.select({
					productName: products.name,
					sku: productVariants.sku,
					unitPrice: productVariants.price,
				})
				.from(productVariants)
				.innerJoin(products, sellable)
				.where(eq(productVariants.id, variantId));
			if (!variant) {
				return invalid("variantId is not a variant the store sells");
			}
			const [line] = await tx
				.select({ quantity: orderLines.quantity })
				.from(orderLines)
				.where(
					and(
						eq(orderLines.orderId, id),
						eq(orderLines.variantId, variantId),
					),
				);
			const total = (line?.quantity ?? 0) + quantity;
			if (total > MAX_QUANTITY) {
				invalid(`A line holds up to ${MAX_QUANTITY} units`);
			}
			await ensureStock(tx, variantId, total);
			await tx
				.insert(orderLines)
				.values({
					...variant,
					tenantId: TenantContext.id(),
					orderId: id,
					variantId,
					quantity: total,
					position: sql`(select coalesce(max(${orderLines.position}), -1) + 1 from ${orderLines} where ${orderLines.orderId} = ${id})`,
				})
				.onConflictDoUpdate({
					target: [orderLines.orderId, orderLines.variantId],
					set: { quantity: total },
				});
			await reprice(tx, id);
			return cartView(tx, id);
		});
	}

	/**
	 * Places the order: brings it up to date with the catalog, then awaits
	 * payment with its stock reserved. 409 for a cart without lines, buyer or
	 * shipping address, or without the stock.
	 */
	place(tokenHash: string): Promise<CartDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const order = await lockOrder(tx, tokenHash);
			if (!order) {
				return undefined;
			}
			if (order.state === "cart") {
				await reprice(tx, order.id);
				const [line] = await tx
					.select({ id: orderLines.id })
					.from(orderLines)
					.where(eq(orderLines.orderId, order.id))
					.limit(1);
				const missing = [
					!line && "lines",
					!order.customerId && "a customer",
					!order.shippingAddress && "a shipping address",
				].filter(Boolean);
				if (missing.length > 0) {
					throw new ConflictException(
						`The cart needs ${missing.join(", ")}`,
					);
				}
			}
			await transitionOrder(tx, order.id, "awaiting_payment", {
				party: "buyer",
			});
			return cartView(tx, order.id);
		});
	}

	/** Takes an order awaiting payment back to the cart, releasing its stock; it keeps its number. */
	reopen(tokenHash: string): Promise<CartDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const order = await lockOrder(tx, tokenHash);
			if (!order) {
				return undefined;
			}
			await transitionOrder(tx, order.id, "cart", { party: "buyer" });
			return cartView(tx, order.id);
		});
	}

	/**
	 * Sets who buys: a signed-in buyer, or a guest by e-mail (added when the
	 * store has none; 409 for a registered buyer's e-mail).
	 */
	setCustomer(
		tokenHash: string,
		buyer: { customerId: CustomerId } | { guest: Guest },
	): Promise<CartDto | undefined> {
		return this.changeCart(tokenHash, async (tx, id) => {
			const customerId =
				"customerId" in buyer
					? buyer.customerId
					: await guestCustomer(tx, buyer.guest);
			await tx
				.update(orders)
				.set({ customerId })
				.where(eq(orders.id, id));
		});
	}

	/** Keeps a copy of the address to ship to, or to bill. */
	setAddress(
		tokenHash: string,
		kind: "shipping" | "billing",
		address: OrderAddress,
	): Promise<CartDto | undefined> {
		return this.changeCart(tokenHash, async (tx, id) => {
			await tx
				.update(orders)
				.set(
					kind === "shipping"
						? { shippingAddress: address }
						: { billingAddress: address },
				)
				.where(eq(orders.id, id));
		});
	}

	/** null when the cart has no such line; 409 past the units in stock. */
	setQuantity(
		tokenHash: string,
		lineId: OrderLineId,
		quantity: number,
	): Promise<CartDto | null | undefined> {
		return this.changeLine(tokenHash, lineId, async (tx, line) => {
			if (line.variantId) {
				await ensureStock(tx, line.variantId, quantity);
			}
			await tx
				.update(orderLines)
				.set({ quantity })
				.where(eq(orderLines.id, lineId));
		});
	}

	/** null when the cart has no such line. */
	removeLine(
		tokenHash: string,
		lineId: OrderLineId,
	): Promise<CartDto | null | undefined> {
		return this.changeLine(tokenHash, lineId, async (tx) => {
			await tx.delete(orderLines).where(eq(orderLines.id, lineId));
		});
	}

	private changeCart(
		tokenHash: string,
		change: (tx: TenantTransaction, id: OrderId) => Promise<void>,
	): Promise<CartDto | undefined> {
		return this.tenantDb.run(async (tx) => {
			const id = await lockCart(tx, tokenHash);
			if (!id) {
				return undefined;
			}
			await change(tx, id);
			return cartView(tx, id);
		});
	}

	private changeLine(
		tokenHash: string,
		lineId: OrderLineId,
		change: (
			tx: TenantTransaction,
			line: { variantId: ProductVariantId | null },
		) => Promise<void>,
	): Promise<CartDto | null | undefined> {
		return this.tenantDb.run(async (tx) => {
			const id = await lockCart(tx, tokenHash);
			if (!id) {
				return undefined;
			}
			const [line] = await tx
				.select({ variantId: orderLines.variantId })
				.from(orderLines)
				.where(
					and(eq(orderLines.id, lineId), eq(orderLines.orderId, id)),
				);
			if (!line) {
				return null;
			}
			await change(tx, line);
			await reprice(tx, id);
			return cartView(tx, id);
		});
	}
}
