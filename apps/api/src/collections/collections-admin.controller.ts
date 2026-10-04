import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
	Put,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNoContentResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { CollectionId } from "../domain/ids.js";
import { pathId } from "../http/request-body.js";
import {
	CollectionDto,
	CollectionOrderDto,
	CollectionProductsDto,
	CollectionSummaryDto,
	CreateCollectionDto,
	UpdateCollectionDto,
} from "./collection.dto.js";
import {
	parseCollectionChanges,
	parseCollectionOrder,
	parseCollectionProducts,
	parseNewCollection,
} from "./collection-input.js";
import { CollectionsRepository } from "./collections.repository.js";

@Controller("admin/collections")
export class CollectionsAdminController {
	constructor(private readonly collections: CollectionsRepository) {}

	/** Every collection: top level first, each level in order. */
	@Get()
	@PanelScoped()
	list(): Promise<CollectionSummaryDto[]> {
		return this.collections.list();
	}

	/** Puts the collections under one parent in a new order. */
	@Put("order")
	@PanelScoped()
	@ApiBadRequestResponse({
		description:
			"collectionIds does not list every collection under the parent once.",
	})
	async reorder(
		@Body() body: CollectionOrderDto,
	): Promise<CollectionSummaryDto[]> {
		const { parentId, collectionIds } = parseCollectionOrder(body);
		await this.collections.reorder(parentId, collectionIds);
		return this.collections.list();
	}

	@Get(":id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such collection." })
	get(@Param("id") id: string): Promise<CollectionDto> {
		return this.found(pathId(id, CollectionId));
	}

	/** Creates a collection after its siblings. */
	@Post()
	@PanelScoped()
	@ApiBadRequestResponse({
		description: "Invalid collection, or an unknown parent or facet value.",
	})
	@ApiConflictResponse({
		description: "The slug is already in use in the store.",
	})
	async create(@Body() body: CreateCollectionDto): Promise<CollectionDto> {
		return this.found(
			await this.collections.create(parseNewCollection(body)),
		);
	}

	/** Changes the collection's fields or rule, or moves it under another parent. */
	@Patch(":id")
	@PanelScoped()
	@ApiBadRequestResponse({
		description:
			"Invalid changes, an unknown or descendant parent, or a rule on a manual collection.",
	})
	@ApiNotFoundResponse({ description: "The store has no such collection." })
	@ApiConflictResponse({
		description: "The slug is already in use in the store.",
	})
	async update(
		@Param("id") id: string,
		@Body() body: UpdateCollectionDto,
	): Promise<CollectionDto> {
		const collectionId = pathId(id, CollectionId);
		const changes = parseCollectionChanges(body);
		if (!(await this.collections.update(collectionId, changes))) {
			throw new NotFoundException("Collection not found");
		}
		return this.found(collectionId);
	}

	@Delete(":id")
	@HttpCode(204)
	@PanelScoped()
	@ApiNoContentResponse({ description: "Removed." })
	@ApiNotFoundResponse({ description: "The store has no such collection." })
	@ApiConflictResponse({
		description: "The collection has child collections.",
	})
	async remove(@Param("id") id: string): Promise<void> {
		if (!(await this.collections.remove(pathId(id, CollectionId)))) {
			throw new NotFoundException("Collection not found");
		}
	}

	/** Sets a manual collection's products, in order. */
	@Put(":id/products")
	@PanelScoped()
	@ApiBadRequestResponse({
		description: "Invalid list or an unknown product.",
	})
	@ApiNotFoundResponse({ description: "The store has no such collection." })
	@ApiConflictResponse({ description: "It is a rule collection." })
	async setProducts(
		@Param("id") id: string,
		@Body() body: CollectionProductsDto,
	): Promise<CollectionDto> {
		const collectionId = pathId(id, CollectionId);
		const productIds = parseCollectionProducts(body);
		if (!(await this.collections.setProducts(collectionId, productIds))) {
			throw new NotFoundException("Collection not found");
		}
		return this.found(collectionId);
	}

	private async found(id: CollectionId): Promise<CollectionDto> {
		const collection = await this.collections.find(id);
		if (!collection) {
			throw new NotFoundException("Collection not found");
		}
		return collection;
	}
}
