import { ConflictException, Injectable } from "@nestjs/common";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import type { Guest } from "../customers/customer-input.js";
import { guestCustomer } from "../customers/customers.repository.js";
import { customers } from "../database/schemas/customers.js";
import { orderLines } from "../database/schemas/order-lines.js";
import { type OrderAddress, orders } from "../database/schemas/orders.js";
import { productVariants } from "../database/schemas/product-variants.js";
import { products } from "../database/schemas/products.js";
import { shippingMethods } from "../database/schemas/shipping-methods.js";
import { stockLevels } from "../database/schemas/stock-levels.js";
import type { Cep } from "../domain/cep.js";
import type {
	CustomerId,
	OrderId,
	OrderLineId,
	ProductVariantId,
	ShippingMethodId,
} from "../domain/ids.js";
import type { Money } from "../domain/money.js";
import { invalid } from "../http/request-body.js";
import type { Parcel } from "../shipping/shipping-calculator.js";
import type { ShippingChoice } from "../shipping/shipping-quotes.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../tenancy/tenant-database.js";
import { MAX_QUANTITY } from "./cart-input.js";
import { newCartToken } from "./cart-token.js";
import type { CartDto, CheckoutStep } from "./order.dto.js";
import { linesOf, shippingMethodOf } from "./order-lines.js";
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
			shippingMethodId: orders.shippingMethodId,
		})
		.from(orders)
		.where(eq(orders.tokenHash, tokenHash))
		.for("update", { of: orders });
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

/**
 * Drops the shipping the buyer chose, whose price no longer fits the cart.
 * Runs when the lines change, and when the CEP to ship to changes (`where`).
 */
async function clearShipping(tx: TenantTransaction, id: OrderId, where?: SQL) {
	await tx
		.update(orders)
		.set({
			shippingMethodId: null,
			shippingMethodName: null,
			shippingDeliveryDays: null,
			shipping: sql`0`,
			total: sql`${orders.subtotal} - ${orders.discount}`,
		})
		.where(and(eq(orders.id, id), where));
}

/**
 * What the cart ships, to quote it: its lines with their variants' weight
 * and dimensions, and the CEP (`cep`, or the shipping address's).
 */
async function parcelOf(
	tx: TenantTransaction,
	id: OrderId,
	cep: Cep | undefined,
): Promise<Parcel> {
	const [order] = await tx
		.select({
			subtotal: orders.subtotal,
			shippingAddress: orders.shippingAddress,
		})
		.from(orders)
		.where(eq(orders.id, id));
	const items = await tx
		.select({
			variantId: sql<ProductVariantId>`${productVariants.id}`,
			quantity: orderLines.quantity,
			unitPrice: orderLines.unitPrice,
			weight: productVariants.weight,
			height: productVariants.height,
			width: productVariants.width,
			length: productVariants.length,
		})
		.from(orderLines)
		.innerJoin(
			productVariants,
			eq(productVariants.id, orderLines.variantId),
		)
		.where(eq(orderLines.orderId, id))
		.orderBy(asc(orderLines.position));
	return {
		destination: cep ?? order.shippingAddress?.cep ?? null,
		subtotal: order.subtotal,
		items,
	};
}

/** A method priced for a parcel, as the quote for it. */
interface Quoted {
	parcel: Parcel;
	choice: ShippingChoice;
}

/**
 * 409 unless the cart still ships what was quoted, with the same method:
 * the cart changed meanwhile and the buyer tries again.
 */
async function ensureQuoted(
	tx: TenantTransaction,
	id: OrderId,
	methodId: string | null,
	quoted: Quoted | null,
) {
	const parcel = quoted && (await parcelOf(tx, id, undefined));
	if (
		methodId !== (quoted?.choice.methodId ?? null) ||
		JSON.stringify(parcel) !== JSON.stringify(quoted?.parcel ?? null)
	) {
		throw new ConflictException("The cart changed meanwhile; try again");
	}
}

/** Keeps the quoted method and prices it into the order's total. */
async function applyShipping(
	tx: TenantTransaction,
	id: OrderId,
	choice: ShippingChoice,
) {
	await tx
		.update(orders)
		.set({
			shippingMethodId: choice.methodId,
			shippingMethodName: choice.name,
			shippingDeliveryDays: choice.deliveryDays,
			shipping: choice.price,
			total: sql`${orders.subtotal} - ${orders.discount} + ${choice.price}`,
		})
		.where(eq(orders.id, id));
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
			shippingKind: shippingMethods.kind,
			shippingAddress: orders.shippingAddress,
			billingAddress: orders.billingAddress,
			subtotal: orders.subtotal,
			discount: orders.discount,
			shipping: orders.shipping,
			total: orders.total,
			shippingMethod: shippingMethodOf,
			trackingCode: orders.trackingCode,
		})
		.from(orders)
		.leftJoin(customers, eq(customers.id, orders.customerId))
		.leftJoin(
			shippingMethods,
			eq(shippingMethods.id, orders.shippingMethodId),
		)
		.where(eq(orders.id, id));
	const lines = await linesOf(tx, id);
	const {
		state,
		number,
		email,
		shippingKind,
		shippingAddress,
		billingAddress,
		...rest
	} = order;
	const missing: CheckoutStep[] =
		state === "cart"
			? [
					lines.length === 0 && ("lines" as const),
					!email && ("customer" as const),
					!shippingAddress &&
						shippingKind !== "pickup" &&
						("shipping_address" as const),
					!shippingKind && ("shipping_method" as const),
				].filter((step) => step !== false)
			: [];
	return {
		state,
		number,
		// Only the e-mail: a guest's e-mail can be typed by anyone.
		customer: email ? { email } : null,
		shippingAddress,
		billingAddress,
		lines,
		...rest,
		missing,
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
			await clearShipping(tx, id);
			return cartView(tx, id);
		});
	}

	/**
	 * Before placing: brings the cart up to date with the catalog and
	 * answers what to ship and the chosen method, to price shipping for good.
	 * null when the order is no longer a cart.
	 */
	checkout(
		tokenHash: string,
	): Promise<
		{ parcel: Parcel; methodId: ShippingMethodId | null } | null | undefined
	> {
		return this.tenantDb.run(async (tx) => {
			const order = await lockOrder(tx, tokenHash);
			if (!order) {
				return undefined;
			}
			if (order.state !== "cart") {
				return null;
			}
			await reprice(tx, order.id);
			return {
				parcel: await parcelOf(tx, order.id, undefined),
				methodId: order.shippingMethodId,
			};
		});
	}

	/**
	 * Places the order: brings it up to date with the catalog, prices its
	 * shipping for good with `quoted` (the chosen method quoted for the cart
	 * from checkout()), then awaits payment with its stock reserved. 409 for
	 * a cart without lines, buyer, shipping method or shipping address
	 * (unless picked up at the store), without the stock, or changed since
	 * checkout(). Also 409 when the total is no longer `expectedTotal`, what
	 * the buyer saw: the cart keeps its new prices, for the buyer to see.
	 * Placing an order awaiting payment again for its total answers it as it
	 * is, so a repeated request never fails nor reserves twice.
	 */
	async place(
		tokenHash: string,
		quoted: Quoted | null,
		expectedTotal: Money,
	): Promise<CartDto | undefined> {
		const placed = await this.tenantDb.run(async (tx) => {
			const order = await lockOrder(tx, tokenHash);
			if (!order) {
				return undefined;
			}
			if (order.state === "awaiting_payment") {
				// A repeated placement (a double click, a retry) answers the order as placed.
				const view = await cartView(tx, order.id);
				if (view.total === expectedTotal) {
					return view;
				}
			}
			if (order.state === "cart") {
				await reprice(tx, order.id);
				await ensureQuoted(
					tx,
					order.id,
					order.shippingMethodId,
					quoted,
				);
				if (quoted) {
					await applyShipping(tx, order.id, quoted.choice);
				}
				const { missing, total } = await cartView(tx, order.id);
				if (missing.length > 0) {
					throw new ConflictException(
						`The cart is missing ${missing.join(", ")}`,
					);
				}
				if (total !== expectedTotal) {
					// Commits the new prices: the buyer sees them before placing again.
					return "changed" as const;
				}
			}
			await transitionOrder(tx, order.id, "awaiting_payment", {
				party: "buyer",
			});
			return cartView(tx, order.id);
		});
		if (placed === "changed") {
			throw new ConflictException(
				"The cart's total changed; check it and place it again",
			);
		}
		return placed;
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
			if (kind === "shipping") {
				await clearShipping(
					tx,
					id,
					sql`${orders.shippingAddress}->>'cep' is distinct from ${address.cep}`,
				);
			}
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

	/**
	 * What the cart ships, to quote it, to `cep` or else to its shipping
	 * address. 409 when the order is no longer a cart.
	 */
	parcel(tokenHash: string, cep?: Cep): Promise<Parcel | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [order] = await tx
				.select({ id: orders.id, state: orders.state })
				.from(orders)
				.where(eq(orders.tokenHash, tokenHash));
			if (order && order.state !== "cart") {
				throw new ConflictException(
					"The order has been placed; only a cart can change",
				);
			}
			return order && parcelOf(tx, order.id, cep);
		});
	}

	/**
	 * Keeps the shipping the buyer chose, quoted for `parcel`. 409 when the
	 * cart changed since the quote: the buyer quotes again.
	 */
	setShipping(
		tokenHash: string,
		parcel: Parcel,
		choice: ShippingChoice,
	): Promise<CartDto | undefined> {
		return this.changeCart(tokenHash, async (tx, id) => {
			const current = await parcelOf(tx, id, undefined);
			if (JSON.stringify(current) !== JSON.stringify(parcel)) {
				throw new ConflictException(
					"The cart changed while quoting; quote again",
				);
			}
			await applyShipping(tx, id, choice);
		});
	}

	/** Drops the chosen shipping, which can no longer ship the cart. */
	dropShipping(tokenHash: string): Promise<CartDto | undefined> {
		return this.changeCart(tokenHash, (tx, id) => clearShipping(tx, id));
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
			await clearShipping(tx, id);
			return cartView(tx, id);
		});
	}
}
