import { BadRequestException } from "@nestjs/common";
import { Cep } from "../../domain/cep.js";
import { Money } from "../../domain/money.js";
import type { Parcel } from "../shipping-calculator.js";
import { FixedRateShipping } from "./fixed-rate.js";

const fixed = new FixedRateShipping();
const parcel = (subtotal: number): Parcel => ({
	destination: Cep.parse("01310100"),
	subtotal: Money.parse(subtotal),
	items: [],
});

describe("FixedRateShipping", () => {
	it("reads a price, and optionally a free shipping threshold and the days to deliver", () => {
		expect(fixed.parseConfig({ price: 1500 })).toEqual({
			price: 1500,
			freeAbove: null,
			deliveryDays: null,
		});
		expect(
			fixed.parseConfig({ price: 0, freeAbove: 20000, deliveryDays: 5 }),
		).toEqual({ price: 0, freeAbove: 20000, deliveryDays: 5 });
	});

	it.each([
		undefined,
		null,
		{},
		{ price: -1 },
		{ price: 10.5 },
		{ price: 100, freeAbove: -1 },
		{ price: 100, deliveryDays: 0 },
		{ price: 100, deliveryDays: 366 },
		{ price: 100, other: 1 },
	])("refuses %j", (config) => {
		expect(() => fixed.parseConfig(config)).toThrow(BadRequestException);
	});

	it("charges the price anywhere, even before the buyer gives a CEP", async () => {
		const config = fixed.parseConfig({ price: 1500, deliveryDays: 3 });
		expect(await fixed.quote(config, parcel(10000))).toEqual({
			price: 1500,
			deliveryDays: 3,
		});
		expect(
			await fixed.quote(config, { ...parcel(10000), destination: null }),
		).toEqual({ price: 1500, deliveryDays: 3 });
	});

	it("ships for free from the threshold on", async () => {
		const config = fixed.parseConfig({ price: 1500, freeAbove: 20000 });
		expect((await fixed.quote(config, parcel(19999)))?.price).toBe(1500);
		expect((await fixed.quote(config, parcel(20000)))?.price).toBe(0);
	});
});
