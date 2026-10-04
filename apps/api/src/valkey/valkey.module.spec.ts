import { Test } from "@nestjs/testing";
import { ValkeyModule } from "./valkey.module.js";
import { ValkeyHealth } from "./valkey-health.js";

describe("ValkeyModule", () => {
	const saved = process.env.VALKEY_URL;

	afterEach(() => {
		process.env.VALKEY_URL = saved;
	});

	const compile = () =>
		Test.createTestingModule({ imports: [ValkeyModule] }).compile();

	it("fails at startup without VALKEY_URL", async () => {
		delete process.env.VALKEY_URL;
		await expect(compile()).rejects.toThrow("VALKEY_URL is not set.");
	});

	it("reports an unreachable Valkey as down", async () => {
		// Port 1 refuses connections immediately.
		process.env.VALKEY_URL = "redis://127.0.0.1:1";
		const moduleRef = await compile();

		await expect(moduleRef.get(ValkeyHealth).isReachable()).resolves.toBe(
			false,
		);
		await moduleRef.close();
	});
});
