export class AssetDto {
	id: string;
	/** Permanent public address of the image. */
	url: string;
}

export class AssetPageDto {
	items: AssetDto[];
	page: number;
	pageSize: number;
	/** Assets in every page. */
	total: number;
}
