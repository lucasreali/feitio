import { Test } from "@nestjs/testing";
import { FileStorage } from "../src/storage/file-storage.js";
import { StorageModule } from "../src/storage/storage.module.js";

// Runs against the real storage configured in .env, under a random tenant it deletes.
describe("FileStorage (e2e)", () => {
	let storage: FileStorage;
	const tenantId = crypto.randomUUID();
	const otherTenantId = crypto.randomUUID();

	// Public files may sit behind a CDN that keeps serving a removed file from
	// its cache for a while; a unique query string skips that cache.
	const uncached = (url: string) => `${url}?v=${Date.now()}`;
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
		// Missing objects answer 404, 403 or 400 depending on the service.
		expect((await read(uncached(storage.publicUrl(file.key)))).ok).toBe(
			false,
		);
	});

	it("serves private files only through temporary links", async () => {
		const file = await storage.upload({
			tenantId,
			visibility: "private",
			category: "invoices",
			body: "%PDF-1.4 invoice",
			contentType: "application/pdf",
		});

		expect(file.key).toMatch(/\.pdf$/);
		expect((await read(unsignedPrivateUrl(file.key))).ok).toBe(false);

		const response = await fetch(await storage.temporaryUrl(file.key, 60));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toBe("attachment");
		expect(await response.text()).toBe("%PDF-1.4 invoice");
	});

	it("removes every file of a tenant from both buckets", async () => {
		const upload = (owner: string, visibility: "public" | "private") =>
			storage.upload({
				tenantId: owner,
				visibility,
				category: "reports",
				body: `${owner} ${visibility}`,
				contentType: visibility === "public" ? "image/png" : "text/csv",
			});
		const publicFile = await upload(tenantId, "public");
		const privateFile = await upload(tenantId, "private");
		const otherTenantFile = await upload(otherTenantId, "public");

		await storage.removeTenantFiles(tenantId);

		expect(
			(await read(uncached(storage.publicUrl(publicFile.key)))).ok,
		).toBe(false);
		expect(
			(await read(await storage.temporaryUrl(privateFile.key, 60))).ok,
		).toBe(false);
		expect(await read(storage.publicUrl(otherTenantFile.key))).toEqual({
			ok: true,
			body: `${otherTenantId} public`,
		});
	});
});
