import { Test } from "@nestjs/testing";
import { FileStorage } from "./file-storage.js";
import { StorageModule } from "./storage.module.js";

const complete = {
	STORAGE_ENDPOINT: "http://127.0.0.1:1",
	STORAGE_REGION: "us-east-1",
	STORAGE_PUBLIC_BUCKET: "public",
	STORAGE_PRIVATE_BUCKET: "private",
	STORAGE_ACCESS_KEY_ID: "key",
	STORAGE_SECRET_ACCESS_KEY: "secret",
	STORAGE_PUBLIC_URL: "https://files.example.com/public",
};

describe("StorageModule", () => {
	const saved = { ...process.env };

	afterEach(() => {
		process.env = { ...saved };
	});

	const compileWith = (env: Record<string, string>) => {
		for (const name of Object.keys(complete)) {
			delete process.env[name];
		}
		Object.assign(process.env, env);
		return Test.createTestingModule({ imports: [StorageModule] }).compile();
	};

	it("provides FileStorage when every variable is set", async () => {
		const moduleRef = await compileWith(complete);
		expect(moduleRef.get(FileStorage)).toBeInstanceOf(FileStorage);
	});

	it("names every missing variable, counting empty ones as missing", async () => {
		const { STORAGE_REGION, STORAGE_PUBLIC_URL, ...partial } = complete;

		await expect(
			compileWith({ ...partial, STORAGE_ACCESS_KEY_ID: "" }),
		).rejects.toThrow(
			"Missing storage environment variables: STORAGE_REGION, STORAGE_ACCESS_KEY_ID, STORAGE_PUBLIC_URL.",
		);
	});
});
