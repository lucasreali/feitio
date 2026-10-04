import { BadRequestException } from "@nestjs/common";
import {
	type StoreTheme,
	type ThemeVariable,
	themeVariables,
} from "../database/schemas/store-settings.js";
import { HttpsUrl } from "../domain/https-url.js";
import { ThemeValue } from "../domain/theme-value.js";

const MAX_NAME_LENGTH = 80;
const FIELDS = new Set(["displayName", "logoUrl", "theme"]);

/** What an owner may change in the store settings; absent fields stay as they are. */
export interface StoreSettingsChanges {
	displayName?: string;
	/** null removes the logo. */
	logoUrl?: HttpsUrl | null;
	/** Replaces the whole theme; variables left out fall back to the UI defaults. */
	theme?: StoreTheme;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (message: string): never => {
	throw new BadRequestException(message);
};

/** Validates a PATCH body into domain types, or throws 400. */
export function parseStoreSettingsChanges(body: unknown): StoreSettingsChanges {
	if (!isObject(body) || Object.keys(body).length === 0) {
		return invalid("Send at least one of displayName, logoUrl or theme");
	}
	const unknown = Object.keys(body).filter((field) => !FIELDS.has(field));
	if (unknown.length > 0) {
		return invalid(`Unknown fields: ${unknown.join(", ")}`);
	}
	const changes: StoreSettingsChanges = {};
	if ("displayName" in body) {
		const name =
			typeof body.displayName === "string" ? body.displayName.trim() : "";
		if (!name || name.length > MAX_NAME_LENGTH) {
			invalid(`displayName must have 1 to ${MAX_NAME_LENGTH} characters`);
		}
		changes.displayName = name;
	}
	if ("logoUrl" in body) {
		changes.logoUrl =
			body.logoUrl === null
				? null
				: (typeof body.logoUrl === "string" &&
						HttpsUrl.tryParse(body.logoUrl)) ||
					invalid("logoUrl must be an https URL or null");
	}
	if ("theme" in body) {
		changes.theme = parseTheme(body.theme);
	}
	return changes;
}

function parseTheme(theme: unknown): StoreTheme {
	if (!isObject(theme)) {
		return invalid("theme must be an object");
	}
	const known = new Set<string>(themeVariables);
	return Object.fromEntries(
		Object.entries(theme).map(([name, value]) => {
			if (!known.has(name)) {
				invalid(`Unknown theme variable: ${name}`);
			}
			const parsed =
				typeof value === "string" ? ThemeValue.tryParse(value) : null;
			return [
				name as ThemeVariable,
				parsed ?? invalid(`Invalid value for theme variable ${name}`),
			];
		}),
	);
}
