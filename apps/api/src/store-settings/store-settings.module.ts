import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { StoreSettingsController } from "./store-settings.controller.js";
import { StoreSettingsRepository } from "./store-settings.repository.js";
import { StoreSettingsAdminController } from "./store-settings-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [StoreSettingsController, StoreSettingsAdminController],
	providers: [StoreSettingsRepository],
})
export class StoreSettingsModule {}
