import {
	Body,
	Controller,
	Get,
	Inject,
	NotFoundException,
	Param,
	Patch,
	Post,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { ShippingMethodId } from "../domain/ids.js";
import { pathId } from "../http/request-body.js";
import {
	CreateShippingMethodDto,
	ShippingMethodDto,
	UpdateShippingMethodDto,
} from "./shipping.dto.js";
import {
	parseNewShippingMethod,
	parseShippingMethodChanges,
	type ShippingCalculators,
} from "./shipping-input.js";
import {
	SHIPPING_CALCULATORS,
	ShippingMethodsRepository,
} from "./shipping-methods.repository.js";

/**
 * The store's shipping methods. Only owners change them, as they set what
 * buyers pay. Methods are disabled, never removed.
 */
@Controller("admin/shipping-methods")
export class ShippingMethodsAdminController {
	constructor(
		private readonly methods: ShippingMethodsRepository,
		@Inject(SHIPPING_CALCULATORS)
		private readonly calculators: ShippingCalculators,
	) {}

	/** Every method of the store, enabled or not, by name. */
	@Get()
	@PanelScoped()
	list(): Promise<ShippingMethodDto[]> {
		return this.methods.list();
	}

	@Post()
	@PanelScoped("owner")
	@ApiBadRequestResponse({
		description: "Invalid name, kind or settings for the kind.",
	})
	@ApiConflictResponse({ description: "The name is already in use." })
	create(@Body() body: CreateShippingMethodDto): Promise<ShippingMethodDto> {
		return this.methods.create(
			parseNewShippingMethod(body, this.calculators),
		);
	}

	/** Renames, enables or disables the method, or replaces its settings. */
	@Patch(":id")
	@PanelScoped("owner")
	@ApiBadRequestResponse({
		description: "Invalid changes, or settings that do not fit the kind.",
	})
	@ApiNotFoundResponse({ description: "The store has no such method." })
	@ApiConflictResponse({ description: "The name is already in use." })
	async update(
		@Param("id") id: string,
		@Body() body: UpdateShippingMethodDto,
	): Promise<ShippingMethodDto> {
		const methodId = pathId(id, ShippingMethodId);
		const method = await this.methods.update(
			methodId,
			parseShippingMethodChanges(body),
		);
		if (!method) {
			throw new NotFoundException();
		}
		return method;
	}
}
