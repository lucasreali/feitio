import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { RedisModule } from "../redis/redis.module.js";
import { HealthController } from "./health.controller.js";

@Module({
	imports: [DatabaseModule, RedisModule],
	controllers: [HealthController],
})
export class HealthModule {}
