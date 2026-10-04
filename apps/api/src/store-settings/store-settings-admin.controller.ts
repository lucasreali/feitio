import { Body, Controller, NotFoundException, Patch } from "@nestjs/common";
import { ApiBadRequestResponse, ApiNotFoundResponse } from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { StoreSettingsDto } from "./store-settings.dto.js";
import { toStoreSettingsDto } from "./store-settings.mapper.js";
import { StoreSettingsRepository } from "./store-settings.repository.js";
import { parseStoreSettingsChanges } from "./store-settings-changes.js";
import { UpdateStoreSettingsDto } from "./update-store-settings.dto.js";

@Controller("admin/store")
export class StoreSettingsAdminController {
	constructor(private readonly repository: StoreSettingsRepository) {}

	/** Changes the session store's name, logo or theme. Owners only. */
	@Patch("settings")
	@PanelScoped("owner")
	@ApiBadRequestResponse({ description: "Invalid or empty changes." })
	@ApiNotFoundResponse({ description: "The store has no settings yet." })
	async update(
		@Body() body: UpdateStoreSettingsDto,
	): Promise<StoreSettingsDto> {
		const settings = await this.repository.updateCurrent(
			parseStoreSettingsChanges(body),
		);
		if (!settings) {
			throw new NotFoundException("Store settings not found");
		}
		return toStoreSettingsDto(settings);
	}
}
