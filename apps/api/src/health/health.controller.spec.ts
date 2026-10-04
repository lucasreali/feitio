import { ServiceUnavailableException } from "@nestjs/common";
import type { DatabaseHealth } from "../database/database-health.js";
import type { RedisHealth } from "../redis/redis-health.js";
import { HealthController } from "./health.controller.js";

const controller = (database: boolean, redis: boolean) =>
	new HealthController(
		{ isReachable: async () => database } as DatabaseHealth,
		{ isReachable: async () => redis } as RedisHealth,
	);

describe("HealthController", () => {
	it("reports ok when the database and Redis are reachable", async () => {
		await expect(controller(true, true).check()).resolves.toEqual({
			status: "ok",
			database: "up",
			redis: "up",
		});
	});

	it.each([
		[false, true, "Unreachable: database"],
		[true, false, "Unreachable: redis"],
		[false, false, "Unreachable: database, redis"],
	])(
		"answers 503 when database=%s and redis=%s",
		async (database, redis, message) => {
			const check = controller(database, redis).check();
			await expect(check).rejects.toBeInstanceOf(
				ServiceUnavailableException,
			);
			await expect(check).rejects.toThrow(message);
		},
	);
});
