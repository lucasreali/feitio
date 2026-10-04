import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiNotFoundResponse } from "@nestjs/swagger";
import { Slug } from "../domain/slug.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import {
	StoreCollectionDetailDto,
	StoreCollectionDto,
} from "./collection.dto.js";
import { CollectionsRepository } from "./collections.repository.js";

@Controller("store/collections")
export class CollectionsController {
	constructor(private readonly collections: CollectionsRepository) {}

	/** The store's collections for its navigation: top level first, each level in order. */
	@Get()
	@TenantScoped()
	async list(): Promise<StoreCollectionDto[]> {
		return (await this.collections.list()).map(
			({ id, name, slug, parentId, position }) => ({
				id,
				name,
				slug,
				parentId,
				position,
			}),
		);
	}

	/** A collection's page. Its products come from GET /store/products?collection=. */
	@Get(":slug")
	@TenantScoped()
	@ApiNotFoundResponse({
		description: "Unknown tenant, or the store has no such collection.",
	})
	async get(@Param("slug") slug: string): Promise<StoreCollectionDetailDto> {
		const parsed = Slug.tryParse(slug);
		const collection =
			parsed && (await this.collections.findBySlug(parsed));
		if (!collection) {
			throw new NotFoundException("Collection not found");
		}
		return {
			id: collection.id,
			name: collection.name,
			slug: collection.slug,
			description: collection.description,
			parentId: collection.parentId,
			seoTitle: collection.seoTitle,
			seoDescription: collection.seoDescription,
		};
	}
}
