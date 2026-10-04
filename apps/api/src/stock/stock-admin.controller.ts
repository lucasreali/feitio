import {
	applyDecorators,
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { ProductVariantId } from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import { pathId } from "../http/request-body.js";
import {
	LowStockPageDto,
	StockAdjustmentDto,
	StockMovementPageDto,
	UpdateStockPolicyDto,
	VariantStockDto,
} from "./stock.dto.js";
import { StockRepository } from "./stock.repository.js";
import { parseAdjustment, parseStockPolicyChanges } from "./stock-input.js";

const pageQueries = () =>
	applyDecorators(
		ApiQuery({ name: "page", required: false, description: "From 1." }),
		ApiQuery({
			name: "pageSize",
			required: false,
			description: "1 to 100, 24 by default.",
		}),
		ApiBadRequestResponse({ description: "Invalid page." }),
	);

/** Stock of the store's variants, in the default location. */
@Controller("admin")
export class StockAdminController {
	constructor(private readonly stock: StockRepository) {}

	@Get("variants/:id/stock")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	async find(@Param("id") id: string): Promise<VariantStockDto> {
		return this.variantStock(pathId(id, ProductVariantId));
	}

	/** Changes whether the variant tracks stock, sells past zero and when it is low. */
	@Patch("variants/:id/stock")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid policy." })
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	async updatePolicy(
		@Param("id") id: string,
		@Body() body: UpdateStockPolicyDto,
	): Promise<VariantStockDto> {
		const variantId = pathId(id, ProductVariantId);
		if (
			!(await this.stock.updatePolicy(
				variantId,
				parseStockPolicyChanges(body),
			))
		) {
			throw new NotFoundException();
		}
		return this.variantStock(variantId);
	}

	/** Adds or removes units after a count, and records the movement. */
	@Post("variants/:id/stock/adjustments")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid quantity." })
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	@ApiConflictResponse({
		description: "It would take available stock below zero.",
	})
	async adjust(
		@Param("id") id: string,
		@Body() body: StockAdjustmentDto,
	): Promise<VariantStockDto> {
		const variantId = pathId(id, ProductVariantId);
		await this.stock.adjust(variantId, parseAdjustment(body));
		return this.variantStock(variantId);
	}

	/** Every change to the variant's stock, newest first. */
	@Get("variants/:id/stock/movements")
	@PanelScoped()
	@pageQueries()
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	async movements(
		@Param("id") id: string,
		@Query() query: Record<string, unknown>,
	): Promise<StockMovementPageDto> {
		const variantId = pathId(id, ProductVariantId);
		const page = parsePage(query);
		const result = await this.stock.movements(variantId, page);
		if (!result) {
			throw new NotFoundException();
		}
		return { ...result, page: page.page, pageSize: page.pageSize };
	}

	/** Tracked variants at or below their low stock threshold, fewest units first; archived products left out. */
	@Get("stock/low")
	@PanelScoped()
	@pageQueries()
	async lowStock(
		@Query() query: Record<string, unknown>,
	): Promise<LowStockPageDto> {
		const page = parsePage(query);
		const result = await this.stock.lowStock(page);
		return { ...result, page: page.page, pageSize: page.pageSize };
	}

	private async variantStock(id: ProductVariantId): Promise<VariantStockDto> {
		const stock = await this.stock.find(id);
		if (!stock) {
			throw new NotFoundException();
		}
		return stock;
	}
}
