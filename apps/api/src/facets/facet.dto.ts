export class FacetValueDto {
	id: string;
	name: string;
}

export class FacetDto {
	id: string;
	name: string;
	/** In the order they were created. */
	values: FacetValueDto[];
}

export class CreateFacetDto {
	/** 1 to 80 characters, unique in the store. */
	name: string;
	/** Names of the first values, unique in the facet. */
	values?: string[];
}

export class NameDto {
	/** 1 to 80 characters. */
	name: string;
}
