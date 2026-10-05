import { BadRequestException, NotFoundException } from "@nestjs/common";

/**
 * Small checks for request bodies. Each route's parse function combines them
 * into domain types; anything off is a 400 with a message naming the field.
 */

export const invalid = (message: string): never => {
	throw new BadRequestException(message);
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The body as an object with at least one field, all of them known. */
export function objectBody(
	body: unknown,
	fields: readonly string[],
): Record<string, unknown> {
	if (!isObject(body) || Object.keys(body).length === 0) {
		return invalid(`Send at least one of ${fields.join(", ")}`);
	}
	const unknown = Object.keys(body).filter(
		(field) => !fields.includes(field),
	);
	if (unknown.length > 0) {
		invalid(`Unknown fields: ${unknown.join(", ")}`);
	}
	return body;
}

/** Trimmed text of 1 to `max` characters. */
export function requiredText(
	value: unknown,
	field: string,
	max: number,
): string {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text || text.length > max) {
		invalid(`${field} must have 1 to ${max} characters`);
	}
	return text;
}

/** Trimmed text of up to `max` characters; null and blank text become null. */
export function optionalText(
	value: unknown,
	field: string,
	max: number,
): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string" || value.trim().length > max) {
		return invalid(
			`${field} must be null or text of up to ${max} characters`,
		);
	}
	return value.trim() || null;
}

/** At least one name, each trimmed and different from the others. */
export function textList(value: unknown, field: string, max: number): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		return invalid(`${field} must be a list of at least one name`);
	}
	const names = value.map((name) => requiredText(name, field, max));
	if (new Set(names).size !== names.length) {
		invalid(`${field} has repeated names`);
	}
	return names;
}

/** Distinct ids in the order sent, parsed with the entity's id type. */
export function idList<T>(
	value: unknown,
	field: string,
	id: { tryParse(value: string): T | null },
): T[] {
	if (!Array.isArray(value)) {
		return invalid(`${field} must be a list of ids`);
	}
	const ids = value.map(
		(item) =>
			(typeof item === "string" && id.tryParse(item)) ||
			invalid(`${field} has an invalid id`),
	);
	if (new Set(ids).size !== ids.length) {
		invalid(`${field} has repeated ids`);
	}
	return ids;
}

/**
 * An id from the route path. Anything that is not an id answers 404, like an
 * id the tenant does not have.
 */
export function pathId<T>(
	value: string,
	id: { tryParse(value: string): T | null },
): T {
	const parsed = id.tryParse(value);
	if (parsed === null) {
		throw new NotFoundException();
	}
	return parsed;
}

/** A body with only a `name`, as in renames: trimmed, 1 to `max` characters. */
export function nameBody(body: unknown, max: number): string {
	return requiredText(objectBody(body, ["name"]).name, "name", max);
}

/** A value of a domain type, or a 400 naming the field. */
export const domain =
	<T>(type: { tryParse(value: string): T | null }, field: string) =>
	(value: unknown): T =>
		(typeof value === "string" && type.tryParse(value)) ||
		invalid(`${field} is invalid`);

/** null, or a value of a domain type. */
export const optionalDomain =
	<T>(type: { tryParse(value: string): T | null }, field: string) =>
	(value: unknown): T | null =>
		value === null ? null : domain(type, field)(value);

export type Parsers = Record<string, (value: unknown) => unknown>;
export type Parsed<P extends Parsers> = { [K in keyof P]: ReturnType<P[K]> };

/** The fields sent, each parsed; at least one, and no unknown field. */
export function changes<P extends Parsers>(
	body: unknown,
	parsers: P,
): Partial<Parsed<P>> {
	const fields = objectBody(body, Object.keys(parsers));
	return Object.fromEntries(
		Object.entries(fields).map(([field, value]) => [
			field,
			parsers[field](value),
		]),
	) as Partial<Parsed<P>>;
}

/** Every field parsed: missing ones are refused, or take their default. */
export function complete<P extends Parsers>(
	body: unknown,
	parsers: P,
	defaults: Partial<Parsed<P>>,
): Parsed<P> {
	const sent = changes(body, parsers);
	const missing = Object.keys(parsers).filter(
		(field) => !(field in sent) && !(field in defaults),
	);
	if (missing.length > 0) {
		invalid(`Missing fields: ${missing.join(", ")}`);
	}
	return { ...defaults, ...sent } as Parsed<P>;
}
