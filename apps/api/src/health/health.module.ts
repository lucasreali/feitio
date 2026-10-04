import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { HealthController } from "./health.controller.js";

@Module({
	imports: [DatabaseModule, ValkeyModule],
	controllers: [HealthController],
})
export class HealthModule {}
