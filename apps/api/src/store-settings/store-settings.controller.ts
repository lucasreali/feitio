import { Controller, Get, NotFoundException } from "@nestjs/common";
import { themeVariables } from "../database/schemas/store-settings.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { StoreSettingsDto } from "./store-settings.dto.js";
import { StoreSettingsRepository } from "./store-settings.repository.js";

@Controller("store")
export class StoreSettingsController {
	constructor(private readonly repository: StoreSettingsRepository) {}

	/** Display settings of the tenant's store, used by the checkout and the stores. */
	@Get("settings")
	@TenantScoped()
	async settings(): Promise<StoreSettingsDto> {
		const settings = await this.repository.findCurrent();
		if (!settings) {
			throw new NotFoundException("Store settings not found");
		}
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
}
