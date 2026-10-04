const HOW_TO_FIX =
	"Copy apps/api/.env.example to apps/api/.env or set it in the environment.";

/** Fails startup with a configuration error that says how to fix it. */
export function configError(message: string): never {
	throw new Error(`${message} ${HOW_TO_FIX}`);
}

/** The value of a required environment variable; empty counts as missing. */
export function requireEnv(name: string): string {
	return process.env[name] || configError(`${name} is not set.`);
}

/** The variables among `names` that are missing or empty, in order. */
export function missingEnv(names: readonly string[]): string[] {
	return names.filter((name) => !process.env[name]);
}
