import { BadRequestException } from "@nestjs/common";
import { FixedRateShipping } from "./adapters/fixed-rate.js";
import { StorePickupShipping } from "./adapters/store-pickup.js";
import type { ShippingCalculator } from "./shipping-calculator.js";
import {
	parseNewShippingMethod,
	parseShippingMethodChanges,
} from "./shipping-input.js";

const calculators = {
	fixed: new FixedRateShipping(),
	pickup: new StorePickupShipping(),
	melhor_envio: {
		parseConfig: () => ({ checked: true }),
	} as unknown as ShippingCalculator,
};

describe("parseNewShippingMethod", () => {
	it("reads the name and kind, and has the kind's calculator check the config", () => {
		expect(
			parseNewShippingMethod(
				{ name: " Sedex ", kind: "fixed", config: { price: 2500 } },
				calculators,
			),
		).toEqual({
			name: "Sedex",
			kind: "fixed",
			config: { price: 2500, freeAbove: null, deliveryDays: null },
			enabled: true,
		});
		expect(
			parseNewShippingMethod(
				{ name: "Retirada", kind: "pickup", enabled: false },
				calculators,
			),
		).toEqual({
			name: "Retirada",
			kind: "pickup",
			config: {},
			enabled: false,
		});
		expect(
			parseNewShippingMethod(
				{ name: "PAC", kind: "melhor_envio", config: {} },
				calculators,
			).config,
		).toEqual({ checked: true });
	});

	it.each([
		{ kind: "fixed", config: { price: 1 } },
		{ name: "x", kind: "drone" },
		{ name: "x", kind: "fixed" },
		{ name: "x", kind: "pickup", enabled: "yes" },
		{ name: "x", kind: "pickup", other: 1 },
	])("refuses %j", (body) => {
		expect(() => parseNewShippingMethod(body, calculators)).toThrow(
			BadRequestException,
		);
	});
});

describe("parseShippingMethodChanges", () => {
	it("keeps only the fields sent; the config is checked against the method's kind later", () => {
		expect(
			parseShippingMethodChanges({
				enabled: false,
				config: { price: 1 },
			}),
		).toEqual({ enabled: false, config: { price: 1 } });
		expect(parseShippingMethodChanges({ name: " PAC " })).toEqual({
			name: "PAC",
		});
	});

	it.each([{}, { kind: "pickup" }, { name: "" }, { enabled: null }])(
		"refuses %j",
		(body) => {
			expect(() => parseShippingMethodChanges(body)).toThrow(
				BadRequestException,
			);
		},
	);
});
