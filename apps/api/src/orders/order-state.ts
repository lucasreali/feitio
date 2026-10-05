import type { StockMovementKind } from "../database/schemas/stock-movements.js";

/**
 * An order's life. `cart`: the buyer is adding items (the cart is the order
 * itself). `awaiting_payment`: placed, stock reserved. `paid`, `preparing`
 * (being picked and packed), `shipped` and `delivered` follow; `cancelled`
 * and `delivered` are final.
 */
export const ORDER_STATES = [
	"cart",
	"awaiting_payment",
	"paid",
	"preparing",
	"shipped",
	"delivered",
	"cancelled",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

/** Who moves an order: the buyer in the store, the store's staff, or the system (jobs, payments). */
export type OrderParty = "buyer" | "staff" | "system";

/** Each allowed transition, with who may make it and what it does to stock. */
const transitions: Partial<
	Record<
		OrderState,
		Partial<
			Record<
				OrderState,
				{ by: readonly OrderParty[]; stock: StockMovementKind | null }
			>
		>
	>
> = {
	cart: { awaiting_payment: { by: ["buyer"], stock: "reservation" } },
	awaiting_payment: {
		// The buyer goes back to change the cart.
		cart: { by: ["buyer"], stock: "release" },
		paid: { by: ["staff", "system"], stock: "sale" },
		cancelled: { by: ["staff", "system"], stock: "release" },
	},
	paid: {
		preparing: { by: ["staff"], stock: null },
		cancelled: { by: ["staff"], stock: "return" },
	},
	preparing: {
		shipped: { by: ["staff"], stock: null },
		cancelled: { by: ["staff"], stock: "return" },
	},
	shipped: { delivered: { by: ["staff", "system"], stock: null } },
};

export function transitionAllowed(
	from: OrderState,
	to: OrderState,
	by: OrderParty,
): boolean {
	return transitions[from]?.[to]?.by.includes(by) ?? false;
}

/** The stock movement of an allowed transition, or null when it moves none. */
export function stockMovementOf(
	from: OrderState,
	to: OrderState,
): StockMovementKind | null {
	return transitions[from]?.[to]?.stock ?? null;
}
