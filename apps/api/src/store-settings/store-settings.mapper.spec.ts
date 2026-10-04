import type { StoreTheme } from "../database/schemas/store-settings.js";
import { toStoreSettingsDto } from "./store-settings.mapper.js";

describe("toStoreSettingsDto", () => {
	it("returns the display fields and the known theme variables", () => {
		expect(
			toStoreSettingsDto({
				displayName: "Aurora Ateliê",
				logoUrl: null,
				theme: {
					primary: "#c2410c",
					"primary-foreground": "#fff8f0",
					"font-family": "Comic Sans",
				} as StoreTheme,
			}),
		).toEqual({
			displayName: "Aurora Ateliê",
			logoUrl: null,
			theme: { primary: "#c2410c", "primary-foreground": "#fff8f0" },
		});
	});

	it("keeps an empty theme empty", () => {
		expect(
			toStoreSettingsDto({
				displayName: "Brisa",
				logoUrl: "https://x/l.png",
				theme: {},
			}).theme,
		).toEqual({});
	});
});
