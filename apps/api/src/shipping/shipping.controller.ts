import { Controller, Get, NotFoundException, Query } from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { ShippingOptionDto } from "./shipping.dto.js";
import { parseSimulation } from "./shipping-input.js";
import { ShippingMethodsRepository } from "./shipping-methods.repository.js";
import { ShippingQuotes } from "./shipping-quotes.js";

/** Shipping for the stores, before there is a cart. */
@Controller("store/shipping-options")
export class ShippingController {
	constructor(
		private readonly methods: ShippingMethodsRepository,
		private readonly quotes: ShippingQuotes,
	) {}

	/**
	 * A product page's simulation: the methods that can ship units of a
	 * variant to a CEP, priced for them and cheapest first. Only an estimate:
	 * the order's shipping is priced when it is placed.
	 */
	@Get()
	@TenantScoped()
	@ApiQuery({ name: "variantId", required: true })
	@ApiQuery({
		name: "cep",
		required: true,
		description: "8 digits, with or without the hyphen.",
	})
	@ApiQuery({
		name: "quantity",
		required: false,
		description: "1 to 999, 1 by default.",
	})
	@ApiBadRequestResponse({ description: "Invalid variant, CEP or quantity." })
	@ApiNotFoundResponse({
		description: "The store does not sell this variant.",
	})
	async simulate(
		@Query() query: Record<string, unknown>,
	): Promise<ShippingOptionDto[]> {
		const parcel = await this.methods.variantParcel(parseSimulation(query));
		if (!parcel) {
			throw new NotFoundException();
		}
		return this.quotes.options(parcel);
	}
}
