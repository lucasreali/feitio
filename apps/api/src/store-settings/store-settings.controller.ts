import { Controller, Get, NotFoundException } from "@nestjs/common";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { StoreSettingsDto } from "./store-settings.dto.js";
import { toStoreSettingsDto } from "./store-settings.mapper.js";
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
		return toStoreSettingsDto(settings);
	}
}
