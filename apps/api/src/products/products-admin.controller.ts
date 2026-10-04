import {
	BadRequestException,
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
import {
	type ProductStatus,
	productStatus,
} from "../database/schemas/products.js";
import { ProductId } from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import { pathId } from "../http/request-body.js";
import {
	AdminProductPageDto,
	CreateProductDto,
	ProductDto,
	UpdateProductDto,
} from "./product.dto.js";
import { parseNewProduct, parseProductChanges } from "./product-input.js";
import { ProductList } from "./product-list.js";
import { ProductsRepository } from "./products.repository.js";

@Controller("admin/products")
export class ProductsAdminController {
	constructor(
		private readonly products: ProductsRepository,
		private readonly list: ProductList,
	) {}

	/** The store's products, newest first, in every status unless filtered. */
	@Get()
	@PanelScoped()
	@ApiQuery({ name: "page", required: false, description: "From 1." })
	@ApiQuery({
		name: "pageSize",
		required: false,
		description: "1 to 100, 24 by default.",
	})
	@ApiQuery({
		name: "status",
		required: false,
		enum: productStatus.enumValues,
	})
	@ApiBadRequestResponse({ description: "Invalid page or status." })
	async page(
		@Query() query: Record<string, unknown>,
	): Promise<AdminProductPageDto> {
		const page = parsePage(query);
		const statuses: readonly unknown[] = productStatus.enumValues;
		if (query.status !== undefined && !statuses.includes(query.status)) {
			throw new BadRequestException(
				`status must be one of ${statuses.join(", ")}`,
			);
		}
		const { items, total } = await this.list.find({
			status: query.status as ProductStatus | undefined,
			page,
		});
		return { items, page: page.page, pageSize: page.pageSize, total };
	}

	@Get(":id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such product." })
	get(@Param("id") id: string): Promise<ProductDto> {
		return this.found(pathId(id, ProductId));
	}

	/** Creates a draft product with its first variant. */
	@Post()
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid product or variant." })
	@ApiConflictResponse({
		description: "The slug or the SKU is already in use in the store.",
	})
	async create(@Body() body: CreateProductDto): Promise<ProductDto> {
		return this.found(await this.products.create(parseNewProduct(body)));
	}

	/** Changes the product's fields, status, images or facet values. */
	@Patch(":id")
	@PanelScoped()
	@ApiBadRequestResponse({
		description: "Invalid changes, or an unknown asset or facet value.",
	})
	@ApiNotFoundResponse({ description: "The store has no such product." })
	@ApiConflictResponse({
		description: "The slug is already in use in the store.",
	})
	async update(
		@Param("id") id: string,
		@Body() body: UpdateProductDto,
	): Promise<ProductDto> {
		const productId = pathId(id, ProductId);
		const changes = parseProductChanges(body);
		if (!(await this.products.update(productId, changes))) {
			throw new NotFoundException("Product not found");
		}
		return this.found(productId);
	}

	private async found(id: ProductId): Promise<ProductDto> {
		const product = await this.products.find(id);
		if (!product) {
			throw new NotFoundException("Product not found");
		}
		return product;
	}
}
