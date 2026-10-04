import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { HealthModule } from "./health/health.module.js";
import { SessionModule } from "./session/session.module.js";
import { StorageModule } from "./storage/storage.module.js";

@Module({
	imports: [HealthModule, SessionModule, StorageModule],
	controllers: [AppController],
	providers: [AppService],
})
export class AppModule {}
