import {
	BadRequestException,
	Controller,
	Get,
	NotFoundException,
	Param,
	Query,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import { CollectionsRepository } from "../collections/collections.repository.js";
import { Slug } from "../domain/slug.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { ProductDto, ProductPageDto } from "./product.dto.js";
import { ProductList } from "./product-list.js";
import { parseStoreProductQuery, productSorts } from "./product-query.js";
import { ProductsRepository } from "./products.repository.js";

@Controller("store/products")
export class ProductsController {
	constructor(
		private readonly products: ProductsRepository,
		private readonly list: ProductList,
		private readonly collections: CollectionsRepository,
	) {}

	/** The store's active products, filtered, sorted and paged. */
	@Get()
	@TenantScoped()
	@ApiQuery({
		name: "collection",
		required: false,
		description: "A collection's slug.",
	})
	@ApiQuery({
		name: "facetValueIds",
		required: false,
		description:
			"Comma-separated facet value ids: products with any of the values sent of a facet, for every facet sent.",
	})
	@ApiQuery({
		name: "sort",
		required: false,
		enum: productSorts,
		description:
			"Prices sort by each product's lowest variant price. `position` is a manual collection's own order, and its default; other lists default to `newest`.",
	})
	@ApiQuery({ name: "page", required: false, description: "From 1." })
	@ApiQuery({
		name: "pageSize",
		required: false,
		description: "1 to 100, 24 by default.",
	})
	@ApiBadRequestResponse({
		description:
			"Invalid filters, or sort=position without a manual collection.",
	})
	@ApiNotFoundResponse({
		description: "Unknown tenant, or the store has no such collection.",
	})
	async page(
		@Query() query: Record<string, unknown>,
	): Promise<ProductPageDto> {
		const filter = parseStoreProductQuery(query);
		const collection = filter.collection
			? await this.collections.findBySlug(filter.collection)
			: undefined;
		if (filter.collection && !collection) {
			throw new NotFoundException("Collection not found");
		}
		const sort =
			filter.sort ??
			(collection?.kind === "manual" ? "position" : "newest");
		if (sort === "position" && collection?.kind !== "manual") {
			throw new BadRequestException(
				"sort=position needs a manual collection",
			);
		}
		const { items, total } = await this.list.find({
			status: "active",
			collection: collection && {
				id: collection.id,
				kind: collection.kind,
			},
			facetValueIds: filter.facetValueIds,
			sort,
			page: filter.page,
		});
		return {
			items: items.map(({ status: _status, ...card }) => card),
			page: filter.page.page,
			pageSize: filter.page.pageSize,
			total,
		};
	}

	/** An active product with its variants, options, images and facet values. */
	@Get(":slug")
	@TenantScoped()
	@ApiNotFoundResponse({
		description: "Unknown tenant, or the store has no such active product.",
	})
	async get(@Param("slug") slug: string): Promise<ProductDto> {
		const parsed = Slug.tryParse(slug);
		const product =
			parsed && (await this.products.findActiveBySlug(parsed));
		if (!product) {
			throw new NotFoundException("Product not found");
		}
		return product;
	}
}
