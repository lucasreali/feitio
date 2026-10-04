import { StoreThemeDto } from "./store-theme.dto.js";

export class StoreSettingsDto {
	/** Store name shown to buyers. */
	displayName: string;
	/** Public address of the store's logo, if any. */
	logoUrl: string | null;
	theme: StoreThemeDto;
}
