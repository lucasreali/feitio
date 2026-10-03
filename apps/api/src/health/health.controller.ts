import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseHealth } from "../database/database-health.js";
import { HealthResponseDto } from "./health-response.dto.js";

@Controller("health")
export class HealthController {
	constructor(private readonly databaseHealth: DatabaseHealth) {}

	/** Confirms the API is up and can reach the database. */
	@Get()
	async check(): Promise<HealthResponseDto> {
		if (!(await this.databaseHealth.isReachable())) {
			throw new ServiceUnavailableException("Database is unreachable");
		}
		return { status: "ok", database: "up" };
	}
}
