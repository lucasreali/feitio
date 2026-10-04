import type { ProductOptionGroupId, ProductOptionId } from "../domain/ids.js";
import { invalid } from "../http/request-body.js";

/** An option group of a product with the ids of its options. */
export interface GroupOptions {
	id: ProductOptionGroupId;
	optionIds: ProductOptionId[];
}

export interface VariantOption {
	groupId: ProductOptionGroupId;
	optionId: ProductOptionId;
}

/**
 * The variant's option in each of the product's groups, in the groups'
 * order. Exactly one option per group, all of them from this product.
 */
export function combinationOf(
	groups: GroupOptions[],
	optionIds: ProductOptionId[],
): VariantOption[] {
	const combination = groups.map((group) => {
		const chosen = optionIds.filter((id) => group.optionIds.includes(id));
		if (chosen.length !== 1) {
			invalid(
				"optionIds needs exactly one option of each of the product's option groups",
			);
		}
		return { groupId: group.id, optionId: chosen[0] };
	});
	if (combination.length !== optionIds.length) {
		invalid("optionIds has an option that is not of this product");
	}
	return combination;
}

/** Whether two variants have the same options, in any order. */
export const sameCombination = (a: ProductOptionId[], b: ProductOptionId[]) =>
	a.length === b.length && a.every((id) => b.includes(id));
