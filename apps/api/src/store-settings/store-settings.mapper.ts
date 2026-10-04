import {
	type StoreTheme,
	themeVariables,
} from "../database/schemas/store-settings.js";
import type { StoreSettingsDto } from "./store-settings.dto.js";

interface StoreSettingsRow {
	displayName: string;
	logoUrl: string | null;
	theme: StoreTheme;
}

/** The public view of a store's settings: only the theme variables the UIs know. */
export function toStoreSettingsDto(
	settings: StoreSettingsRow,
): StoreSettingsDto {
	const theme = Object.fromEntries(
		themeVariables
			.filter((name) => settings.theme[name] !== undefined)
			.map((name) => [name, settings.theme[name]]),
	);
	return {
		displayName: settings.displayName,
		logoUrl: settings.logoUrl,
		theme,
	};
}
