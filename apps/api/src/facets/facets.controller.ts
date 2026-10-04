import { Controller, Get } from "@nestjs/common";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { FacetDto } from "./facet.dto.js";
import { FacetsRepository } from "./facets.repository.js";

@Controller("store")
export class FacetsController {
	constructor(private readonly facets: FacetsRepository) {}

	/** The store's facets and values, for the product filters. */
	@Get("facets")
	@TenantScoped()
	list(): Promise<FacetDto[]> {
		return this.facets.list();
	}
}
