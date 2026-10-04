import { eq, like, or } from "drizzle-orm";
import type { collections } from "../database/schemas/collections.js";
import type { products } from "../database/schemas/products.js";
import { Slug } from "../domain/slug.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";

const MAX_LENGTH = 120;

/**
 * `base`, or `base-2`, `base-3`... whichever the store does not use yet in
 * the table. Two rows created at once with the same name may still collide:
 * the unique key then answers 409, and a retry gets the next suffix.
 */
export async function freeSlug(
	tx: TenantTransaction,
	table: typeof products | typeof collections,
	base: Slug,
): Promise<Slug> {
	const taken = new Set(
		(
			await tx
				.select({ slug: table.slug })
				.from(table)
				.where(or(eq(table.slug, base), like(table.slug, `${base}-%`)))
		).map((row) => row.slug as string),
	);
	for (let suffix = 1; ; suffix++) {
		const ending = suffix === 1 ? "" : `-${suffix}`;
		const candidate = Slug.parse(
			`${base.slice(0, MAX_LENGTH - ending.length).replace(/-+$/, "")}${ending}`,
		);
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}
