import { ProductVariantId } from "../domain/ids.js";
import { invalid, objectBody } from "../http/request-body.js";

/** Units of one variant in an order. */
export const MAX_QUANTITY = 999;

const quantity = (value: unknown): number =>
	Number.isInteger(value) &&
	(value as number) >= 1 &&
	(value as number) <= MAX_QUANTITY
		? (value as number)
		: invalid(`quantity must be a whole number from 1 to ${MAX_QUANTITY}`);

/** Body of POST /store/cart/lines. The price always comes from the catalog. */
export function parseNewLine(body: unknown): {
	variantId: ProductVariantId;
	quantity: number;
} {
	const fields = objectBody(body, ["variantId", "quantity"]);
	return {
		variantId:
			(typeof fields.variantId === "string" &&
				ProductVariantId.tryParse(fields.variantId)) ||
			invalid("variantId must be a variant id"),
		quantity: quantity(fields.quantity),
	};
}

/** Body of PATCH /store/cart/lines/:id. */
export function parseLineQuantity(body: unknown): number {
	return quantity(objectBody(body, ["quantity"]).quantity);
}
