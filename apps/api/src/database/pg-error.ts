import pg from "pg";

/** SQLSTATE codes the API turns into answers. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

/** The PostgreSQL error behind a failed query, also when Drizzle wraps it. */
export function databaseError(error: unknown): pg.DatabaseError | undefined {
	for (let cause = error; cause instanceof Error; cause = cause.cause) {
		if (cause instanceof pg.DatabaseError) {
			return cause;
		}
	}
	return undefined;
}

/**
 * Runs `fn` and turns a constraint violation into the error mapped to its
 * constraint name or, failing that, to its SQLSTATE code. Other errors pass.
 */
export async function translateConstraints<T>(
	fn: () => Promise<T>,
	map: Record<string, () => Error>,
): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		const cause = databaseError(error);
		const translate =
			(cause?.constraint && map[cause.constraint]) ||
			(cause?.code && map[cause.code]);
		throw translate ? translate() : error;
	}
}
