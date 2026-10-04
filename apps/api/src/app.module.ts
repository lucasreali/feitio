import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { SessionModule } from "./session/session.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { StoreSettingsModule } from "./store-settings/store-settings.module.js";

@Module({
	imports: [HealthModule, SessionModule, StorageModule, StoreSettingsModule],
})
export class AppModule {}
