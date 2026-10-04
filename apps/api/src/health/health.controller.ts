import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseHealth } from "../database/database-health.js";
import { ValkeyHealth } from "../valkey/valkey-health.js";
import { HealthResponseDto } from "./health-response.dto.js";

/**
 * SOLID: depends on the two concrete checks instead of a list of health
 * indicators. Nest has no built-in multi-injection, and with two stable
 * checks editing this controller costs less than the abstraction would.
 */
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
