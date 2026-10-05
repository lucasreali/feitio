import { BadRequestException } from "@nestjs/common";
import { Money } from "../../domain/money.js";
import { StorePickupShipping } from "./store-pickup.js";

const pickup = new StorePickupShipping();

describe("StorePickupShipping", () => {
	it("takes no settings", () => {
		expect(pickup.parseConfig(undefined)).toEqual({});
		expect(pickup.parseConfig({})).toEqual({});
		expect(() => pickup.parseConfig({ price: 100 })).toThrow(
			BadRequestException,
		);
	});

	it("is free and needs no CEP", async () => {
		expect(
			await pickup.quote(
				{},
				{ destination: null, subtotal: Money.parse(5000), items: [] },
			),
		).toEqual({ price: 0, deliveryDays: null });
	});
});
