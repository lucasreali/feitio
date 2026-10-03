import { Test } from "@nestjs/testing";
import { FileStorage } from "../src/storage/file-storage.js";
import { StorageModule } from "../src/storage/storage.module.js";

// Runs against the S3-compatible service from docker-compose.yml (`pnpm services:up`).
describe("FileStorage (e2e)", () => {
	let storage: FileStorage;
	const tenantId = crypto.randomUUID();
	const otherTenantId = crypto.randomUUID();

	const read = async (url: string) => {
		const response = await fetch(url);
		return {
			ok: response.ok,
			body: response.ok ? await response.text() : "",
		};
	};
	// Address of an object in the private bucket without a signature.
	const unsignedPrivateUrl = (key: string) =>
		`${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_PRIVATE_BUCKET}/${key}`;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [StorageModule],
		}).compile();
		storage = moduleRef.get(FileStorage);
	});

	afterAll(async () => {
		await storage.removeTenantFiles(tenantId);
		await storage.removeTenantFiles(otherTenantId);
	});

	it("serves public files from the public address", async () => {
		const file = await storage.upload({
			tenantId,
			visibility: "public",
			category: "products",
			fileName: "Foto Produto.PNG",
			body: "product photo",
			contentType: "image/png",
		});
		expect(file.key).toMatch(
			new RegExp(`^tenants/${tenantId}/products/[0-9a-f-]{36}\\.png$`),
		);

		const response = await fetch(storage.publicUrl(file.key));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(await response.text()).toBe("product photo");

		await storage.remove(file);
		// Missing objects answer 404 or 403 depending on the service and bucket policy.
		expect((await read(storage.publicUrl(file.key))).ok).toBe(false);
	});

	it("serves private files only through temporary links", async () => {
		const file = await storage.upload({
			tenantId,
			visibility: "private",
			category: "invoices",
			fileName: "nota.pdf",
			body: "invoice",
		});

		expect((await read(unsignedPrivateUrl(file.key))).ok).toBe(false);
		expect(await read(await storage.temporaryUrl(file.key, 60))).toEqual({
			ok: true,
			body: "invoice",
		});
	});

	it("removes every file of a tenant from both buckets", async () => {
		const upload = (owner: string, visibility: "public" | "private") =>
			storage.upload({
				tenantId: owner,
				visibility,
				category: "reports",
				fileName: "r.txt",
				body: `${owner} ${visibility}`,
			});
		const publicFile = await upload(tenantId, "public");
		const privateFile = await upload(tenantId, "private");
		const otherTenantFile = await upload(otherTenantId, "public");

		await storage.removeTenantFiles(tenantId);

		expect((await read(storage.publicUrl(publicFile.key))).ok).toBe(false);
		expect(
			(await read(await storage.temporaryUrl(privateFile.key, 60))).ok,
		).toBe(false);
		expect(await read(storage.publicUrl(otherTenantFile.key))).toEqual({
			ok: true,
			body: `${otherTenantId} public`,
		});
	});
});
