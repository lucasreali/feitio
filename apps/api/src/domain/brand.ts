declare const brand: unique symbol;

/**
 * A primitive that TypeScript keeps apart from others of the same kind. At
 * runtime it is the plain value: no wrapper object, no conversion cost.
 */
export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** `parse` (throws) and `tryParse` (null) for a branded string with a format rule. */
export function brandedString<Name extends string>(
	name: Name,
	isValid: (value: string) => boolean,
) {
	type Branded = Brand<string, Name>;
	return {
		parse(value: string): Branded {
			if (!isValid(value)) {
				throw new Error(`Invalid ${name}: "${value}"`);
			}
			return value as Branded;
		},
		tryParse(value: string): Branded | null {
			return isValid(value) ? (value as Branded) : null;
		},
	};
}
