import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseHealth } from "../database/database-health.js";
import { ValkeyHealth } from "../valkey/valkey-health.js";
import { HealthResponseDto } from "./health-response.dto.js";

@Controller("health")
export class HealthController {
	constructor(
		private readonly databaseHealth: DatabaseHealth,
		private readonly valkeyHealth: ValkeyHealth,
	) {}

	/** Confirms the API is up and can reach the database and Valkey. */
	@Get()
	async check(): Promise<HealthResponseDto> {
		const [database, valkey] = await Promise.all([
			this.databaseHealth.isReachable(),
			this.valkeyHealth.isReachable(),
		]);
		const unreachable = [
			!database && "database",
			!valkey && "valkey",
		].filter(Boolean);
		if (unreachable.length > 0) {
			throw new ServiceUnavailableException(
				`Unreachable: ${unreachable.join(", ")}`,
			);
		}
		return { status: "ok", database: "up", valkey: "up" };
	}
}
