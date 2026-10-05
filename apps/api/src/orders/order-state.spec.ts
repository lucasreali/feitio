import {
	ORDER_STATES,
	type OrderState,
	stockMovementOf,
	transitionAllowed,
} from "./order-state.js";

describe("transitionAllowed", () => {
	it.each([
		["cart", "awaiting_payment", "buyer"],
		["awaiting_payment", "cart", "buyer"],
		["awaiting_payment", "paid", "staff"],
		["awaiting_payment", "paid", "system"],
		["awaiting_payment", "cancelled", "staff"],
		["awaiting_payment", "cancelled", "system"],
		["paid", "preparing", "staff"],
		["paid", "cancelled", "staff"],
		["preparing", "shipped", "staff"],
		["preparing", "cancelled", "staff"],
		["shipped", "delivered", "staff"],
	] as const)("lets %s go to %s by the %s", (from, to, by) => {
		expect(transitionAllowed(from, to, by)).toBe(true);
	});

	it.each([
		["cart", "paid", "staff"],
		["cart", "cancelled", "staff"],
		["cart", "awaiting_payment", "staff"],
		["awaiting_payment", "paid", "buyer"],
		["awaiting_payment", "cart", "staff"],
		["paid", "awaiting_payment", "staff"],
		["paid", "shipped", "staff"],
		["paid", "cancelled", "buyer"],
		["shipped", "cancelled", "staff"],
		["shipped", "preparing", "staff"],
		["delivered", "cancelled", "staff"],
		["cancelled", "awaiting_payment", "buyer"],
		["paid", "paid", "staff"],
	] as const)("refuses %s to %s by the %s", (from, to, by) => {
		expect(transitionAllowed(from, to, by)).toBe(false);
	});

	it.each(["delivered", "cancelled"] as const)(
		"ends at %s",
		(from: OrderState) => {
			for (const to of ORDER_STATES) {
				for (const by of ["buyer", "staff", "system"] as const) {
					expect(transitionAllowed(from, to, by)).toBe(false);
				}
			}
		},
	);
});

describe("stockMovementOf", () => {
	it.each([
		["cart", "awaiting_payment", "reservation"],
		["awaiting_payment", "cart", "release"],
		["awaiting_payment", "cancelled", "release"],
		["awaiting_payment", "paid", "sale"],
		["paid", "cancelled", "return"],
		["preparing", "cancelled", "return"],
		["paid", "preparing", null],
		["preparing", "shipped", null],
		["shipped", "delivered", null],
	] as const)("moves stock from %s to %s as %s", (from, to, kind) => {
		expect(stockMovementOf(from, to)).toBe(kind);
	});
});
