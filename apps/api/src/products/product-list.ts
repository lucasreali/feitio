import { Injectable } from "@nestjs/common";
import { type SQL, sql } from "drizzle-orm";
import type { CollectionKind } from "../database/schemas/collections.js";
import type { ProductStatus } from "../database/schemas/products.js";
import type {
	AssetId,
	CollectionId,
	FacetValueId,
	ProductId,
} from "../domain/ids.js";
import type { Money } from "../domain/money.js";
import type { Page } from "../http/page.js";
import { FileStorage } from "../storage/file-storage.js";
import type { ObjectKey } from "../storage/object-key.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { AdminProductCardDto } from "./product.dto.js";
import type { ProductSort } from "./product-query.js";

export interface ProductListFilter {
	status?: ProductStatus;
	collection?: { id: CollectionId; kind: CollectionKind };
	/** Products with any of the values of each facet sent, for every facet sent. */
	facetValueIds?: FacetValueId[];
	/** `position` needs a manual collection. */
	sort: ProductSort;
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

/** Validated UUIDs as a PostgreSQL array literal, sent as one parameter. */
const uuidArray = (ids: string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

const orderBy: Record<ProductSort, SQL> = {
	newest: sql`p.created_at desc, p.id desc`,
	name: sql`p.name asc, p.id asc`,
	"price-asc": sql`price.min asc, p.created_at desc, p.id desc`,
	"price-desc": sql`price.min desc, p.created_at desc, p.id desc`,
	position: sql`picked.position asc`,
};

/**
 * Pages of the current tenant's products, with each one's lowest price and
 * first image. Collection rules and facet filters are worked out here, in
 * SQL, when the page is read.
 */
@Injectable()
export class ProductList {
	constructor(
		private readonly tenantDb: TenantDatabase,
		private readonly storage: FileStorage,
	) {}

	async find(
		filter: ProductListFilter,
	): Promise<{ items: AdminProductCardDto[]; total: number }> {
		const { collection } = filter;
		if (filter.sort === "position" && collection?.kind !== "manual") {
			throw new Error("The position sort needs a manual collection");
		}
		const picked =
			collection?.kind === "manual"
				? sql`join collection_products picked on picked.product_id = p.id and picked.collection_id = ${collection.id}`
				: sql``;
		const conditions: SQL[] = [sql`true`];
		if (filter.status) {
			conditions.push(sql`p.status = ${filter.status}`);
		}
		if (collection?.kind === "rule") {
			// Every value of the rule is on the product.
			conditions.push(sql`not exists (
				select 1 from collection_facet_values r
				where r.collection_id = ${collection.id}
					and not exists (
						select 1 from product_facet_values pv
						where pv.product_id = p.id and pv.facet_value_id = r.facet_value_id))`);
		}
		const values = filter.facetValueIds ?? [];
		if (values.length > 0) {
			// Every value sent exists, and for each facet among them the product
			// has at least one of the values sent.
			conditions.push(
				sql`(select count(*) from facet_values where id = any(${uuidArray(values)})) = ${values.length}`,
			);
			conditions.push(sql`not exists (
				select 1 from facet_values chosen
				where chosen.id = any(${uuidArray(values)})
					and not exists (
						select 1 from product_facet_values pv
						join facet_values v on v.id = pv.facet_value_id
						where pv.product_id = p.id
							and v.facet_id = chosen.facet_id
							and pv.facet_value_id = any(${uuidArray(values)})))`);
		}
		const where = sql.join(conditions, sql` and `);
		const [rows, count] = await this.tenantDb.run((tx) =>
			Promise.all([
				tx.execute<ProductRow>(sql`
					select p.id, p.name, p.slug, p.status, price.min as price,
						image.asset_id as image_id, image.key as image_key
					from products p
					${picked}
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
					order by ${orderBy[filter.sort]}
					limit ${filter.page.pageSize} offset ${filter.page.offset}`),
				tx.execute<{ total: number }>(
					sql`select count(*)::int as total from products p ${picked} where ${where}`,
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
