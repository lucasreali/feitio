export class CustomerGroupDto {
	id: string;
	name: string;
	/** Customers in the group. */
	customerCount: number;
}

export class CustomerGroupRefDto {
	id: string;
	name: string;
}
