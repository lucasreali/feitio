import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseHealth } from "../database/database-health.js";
import { RedisHealth } from "../redis/redis-health.js";
import { HealthResponseDto } from "./health-response.dto.js";

@Controller("health")
export class HealthController {
	constructor(
		private readonly databaseHealth: DatabaseHealth,
		private readonly redisHealth: RedisHealth,
	) {}

	/** Confirms the API is up and can reach the database and Redis. */
	@Get()
	async check(): Promise<HealthResponseDto> {
		const [database, redis] = await Promise.all([
			this.databaseHealth.isReachable(),
			this.redisHealth.isReachable(),
		]);
		const unreachable = [!database && "database", !redis && "redis"].filter(
			Boolean,
		);
		if (unreachable.length > 0) {
			throw new ServiceUnavailableException(
				`Unreachable: ${unreachable.join(", ")}`,
			);
		}
		return { status: "ok", database: "up", redis: "up" };
	}
}
