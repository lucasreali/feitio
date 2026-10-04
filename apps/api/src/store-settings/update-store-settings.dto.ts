import { StoreThemeDto } from "./store-theme.dto.js";

/** Send only the fields to change. */
export class UpdateStoreSettingsDto {
	/** Store name shown to buyers, 1 to 80 characters. */
	displayName?: string;
	/** Public https address of the logo; null removes it. */
	logoUrl?: string | null;
	/**
	 * Replaces the whole theme. Values are plain CSS colors and lengths
	 * (`#c2410c`, `oklch(0.7 0.1 200)`, `0.75rem`); no url() or other resources.
	 */
	theme?: StoreThemeDto;
}
