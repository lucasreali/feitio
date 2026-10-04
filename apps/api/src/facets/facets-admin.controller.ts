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
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNoContentResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { FacetId, FacetValueId } from "../domain/ids.js";
import { nameBody, pathId } from "../http/request-body.js";
import { CreateFacetDto, FacetDto, NameDto } from "./facet.dto.js";
import { FACET_NAME_MAX, parseNewFacet } from "./facet-input.js";
import { FacetsRepository } from "./facets.repository.js";

@Controller("admin")
export class FacetsAdminController {
	constructor(private readonly facets: FacetsRepository) {}

	/** The store's facets with their values. */
	@Get("facets")
	@PanelScoped()
	list(): Promise<FacetDto[]> {
		return this.facets.list();
	}

	/** Creates a facet, such as Brand, with its first values. */
	@Post("facets")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name or values." })
	@ApiConflictResponse({
		description: "The store already has a facet with this name.",
	})
	async create(@Body() body: CreateFacetDto): Promise<FacetDto> {
		return this.found(await this.facets.create(parseNewFacet(body)));
	}

	@Patch("facets/:id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such facet." })
	@ApiConflictResponse({
		description: "The store already has a facet with this name.",
	})
	async rename(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<FacetDto> {
		const facetId = pathId(id, FacetId);
		if (
			!(await this.facets.rename(facetId, nameBody(body, FACET_NAME_MAX)))
		) {
			throw new NotFoundException("Facet not found");
		}
		return this.found(facetId);
	}

	/** Removes a facet and takes its values off every product. */
	@Delete("facets/:id")
	@HttpCode(204)
	@PanelScoped()
	@ApiNoContentResponse({ description: "Removed." })
	@ApiNotFoundResponse({ description: "The store has no such facet." })
	@ApiConflictResponse({
		description: "A rule collection uses one of its values.",
	})
	async remove(@Param("id") id: string): Promise<void> {
		if (!(await this.facets.remove(pathId(id, FacetId)))) {
			throw new NotFoundException("Facet not found");
		}
	}

	@Post("facets/:id/values")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such facet." })
	@ApiConflictResponse({
		description: "The facet already has a value with this name.",
	})
	async addValue(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<FacetDto> {
		const facetId = pathId(id, FacetId);
		if (
			!(await this.facets.addValue(
				facetId,
				nameBody(body, FACET_NAME_MAX),
			))
		) {
			throw new NotFoundException("Facet not found");
		}
		return this.found(facetId);
	}

	@Patch("facet-values/:id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such facet value." })
	@ApiConflictResponse({
		description: "The facet already has a value with this name.",
	})
	async renameValue(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<FacetDto> {
		const facetId = await this.facets.renameValue(
			pathId(id, FacetValueId),
			nameBody(body, FACET_NAME_MAX),
		);
		if (!facetId) {
			throw new NotFoundException("Facet value not found");
		}
		return this.found(facetId);
	}

	/** Removes a value and takes it off every product. */
	@Delete("facet-values/:id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such facet value." })
	@ApiConflictResponse({ description: "A rule collection uses this value." })
	async removeValue(@Param("id") id: string): Promise<FacetDto> {
		const facetId = await this.facets.removeValue(pathId(id, FacetValueId));
		if (!facetId) {
			throw new NotFoundException("Facet value not found");
		}
		return this.found(facetId);
	}

	private async found(id: FacetId): Promise<FacetDto> {
		const facet = await this.facets.find(id);
		if (!facet) {
			throw new NotFoundException("Facet not found");
		}
		return facet;
	}
}
