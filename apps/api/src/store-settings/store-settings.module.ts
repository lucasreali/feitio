import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { StoreSettingsController } from "./store-settings.controller.js";
import { StoreSettingsRepository } from "./store-settings.repository.js";

@Module({
	imports: [TenancyModule],
	controllers: [StoreSettingsController],
	providers: [StoreSettingsRepository],
})
export class StoreSettingsModule {}
