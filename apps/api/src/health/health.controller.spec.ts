import { ServiceUnavailableException } from "@nestjs/common";
import type { DatabaseHealth } from "../database/database-health.js";
import type { ValkeyHealth } from "../valkey/valkey-health.js";
import { HealthController } from "./health.controller.js";

const controller = (database: boolean, valkey: boolean) =>
	new HealthController(
		{ isReachable: async () => database } as DatabaseHealth,
		{ isReachable: async () => valkey } as ValkeyHealth,
	);

describe("HealthController", () => {
	it("reports ok when the database and Valkey are reachable", async () => {
		await expect(controller(true, true).check()).resolves.toEqual({
			status: "ok",
			database: "up",
			valkey: "up",
		});
	});

	it.each([
		[false, true, "Unreachable: database"],
		[true, false, "Unreachable: valkey"],
		[false, false, "Unreachable: database, valkey"],
	])(
		"answers 503 when database=%s and valkey=%s",
		async (database, valkey, message) => {
			const check = controller(database, valkey).check();
			await expect(check).rejects.toBeInstanceOf(
				ServiceUnavailableException,
			);
			await expect(check).rejects.toThrow(message);
		},
	);
});
