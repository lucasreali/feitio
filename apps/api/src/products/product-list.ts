import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { ProductStatus } from "../database/schemas/products.js";
import type { AssetId, ProductId } from "../domain/ids.js";
import type { Money } from "../domain/money.js";
import type { Page } from "../http/page.js";
import { FileStorage } from "../storage/file-storage.js";
import type { ObjectKey } from "../storage/object-key.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { AdminProductCardDto } from "./product.dto.js";

export interface ProductListFilter {
	status?: ProductStatus;
	page: Page;
}

interface ProductRow extends Record<string, unknown> {
	id: ProductId;
	name: string;
	slug: string;
	status: ProductStatus;
	price: Money;
	image_id: AssetId | null;
	image_key: ObjectKey | null;
}

/** Pages of the current tenant's products, with each one's lowest price and first image. */
@Injectable()
export class ProductList {
	constructor(
		private readonly tenantDb: TenantDatabase,
		private readonly storage: FileStorage,
	) {}

	async find(
		filter: ProductListFilter,
	): Promise<{ items: AdminProductCardDto[]; total: number }> {
		const where = filter.status
			? sql`p.status = ${filter.status}`
			: sql`true`;
		const [rows, count] = await this.tenantDb.run((tx) =>
			Promise.all([
				tx.execute<ProductRow>(sql`
					select p.id, p.name, p.slug, p.status, price.min as price,
						image.asset_id as image_id, image.key as image_key
					from products p
					cross join lateral (
						select min(v.price) as min from product_variants v where v.product_id = p.id
					) price
					left join lateral (
						select i.asset_id, a.key
						from product_images i join assets a on a.id = i.asset_id
						where i.product_id = p.id
						order by i.position
						limit 1
					) image on true
					where ${where}
					order by p.created_at desc, p.id desc
					limit ${filter.page.pageSize} offset ${filter.page.offset}`),
				tx.execute<{ total: number }>(
					sql`select count(*)::int as total from products p where ${where}`,
				),
			]),
		);
		return {
			items: rows.rows.map((row) => ({
				id: row.id,
				name: row.name,
				slug: row.slug,
				status: row.status,
				price: row.price,
				image:
					row.image_id && row.image_key
						? {
								id: row.image_id,
								url: this.storage.publicUrl(row.image_key),
							}
						: null,
			})),
			total: count.rows[0].total,
		};
	}
}
