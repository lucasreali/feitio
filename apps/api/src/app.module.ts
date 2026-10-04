import { Module } from "@nestjs/common";
import { AssetsModule } from "./assets/assets.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HealthModule } from "./health/health.module.js";
import { SessionModule } from "./session/session.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { StoreSettingsModule } from "./store-settings/store-settings.module.js";

@Module({
	imports: [
		AssetsModule,
		AuthModule,
		HealthModule,
		SessionModule,
		StorageModule,
		StoreSettingsModule,
	],
})
export class AppModule {}
