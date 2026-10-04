import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { DATABASE, type Database } from "../src/database/database.js";
import { assets } from "../src/database/schemas/assets.js";
import { SessionService } from "../src/session/session.service.js";
import { FileStorage } from "../src/storage/file-storage.js";
import { buildObjectKey } from "../src/storage/object-key.js";
import { TenantContext } from "../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../src/tenancy/tenant-database.js";
import {
	Fixtures,
	type PanelAuth,
	signIn,
	type TestTenant,
	type TestUser,
} from "./fixtures.js";

const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x70, 0x6e, 0x67,
]);

/** A multipart/form-data body with one file field. */
function multipartFile(body: Buffer, contentType: string, field = "file") {
	const boundary = `----feitio${crypto.randomUUID()}`;
	return {
		payload: Buffer.concat([
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="photo"\r\nContent-Type: ${contentType}\r\n\r\n`,
			),
			body,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		]),
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
		},
	};
}

// Public files may sit behind a CDN cache; a unique query string skips it.
const fetchUncached = (url: string) => fetch(`${url}?v=${Date.now()}`);

// Runs against the real PostgreSQL, Valkey and storage in .env.
describe("Assets (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let tenantDb: TenantDatabase;
	let storage: FileStorage;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;

	const upload = (
		auth: Partial<PanelAuth>,
		file: ReturnType<typeof multipartFile>,
	) =>
		app.inject({
			method: "POST",
			url: "/admin/assets",
			payload: file.payload,
			cookies: auth.cookies,
			headers: { ...auth.headers, ...file.headers },
		});
	const remove = (auth: Partial<PanelAuth>, id: string) =>
		app.inject({
			method: "DELETE",
			url: `/admin/assets/${id}`,
			cookies: auth.cookies,
			headers: auth.headers,
		});
	const assetsOf = (tenant: TestTenant) =>
		TenantContext.run(tenant, () =>
			tenantDb.run((tx) => tx.select().from(assets)),
		);

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();
		app = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		tenantDb = moduleRef.get(TenantDatabase);
		storage = moduleRef.get(FileStorage);

		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		[staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
	});

	afterAll(async () => {
		for (const tenant of [store, otherStore]) {
			await storage.removeTenantFiles(tenant.id);
		}
		const sessions = app.get(SessionService);
		for (const user of [staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	describe("POST /admin/assets", () => {
		it("stores an image in the public bucket and records it", async () => {
			const response = await upload(
				await signIn(app, staff),
				multipartFile(PNG, "image/png"),
			);

			expect(response.statusCode).toBe(201);
			const asset = response.json<{ id: string; url: string }>();
			expect(asset.url).toMatch(
				new RegExp(`/tenants/${store.id}/assets/[0-9a-f-]{36}\\.png$`),
			);
			const file = await fetch(asset.url);
			expect(file.headers.get("content-type")).toBe("image/png");
			expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
			expect((await assetsOf(store)).map((row) => row.id)).toContain(
				asset.id,
			);
		});

		it("goes by the file's bytes, not by the declared type", async () => {
			const auth = await signIn(app, staff);

			const declaredWrong = await upload(
				auth,
				multipartFile(PNG, "application/octet-stream"),
			);
			expect(declaredWrong.statusCode).toBe(201);
			expect(declaredWrong.json().url).toMatch(/\.png$/);

			const disguised = await upload(
				auth,
				multipartFile(
					Buffer.from("<html><script>alert(1)</script></html>"),
					"image/png",
				),
			);
			expect(disguised.statusCode).toBe(415);
		});

		it("answers 400 without a file", async () => {
			const auth = await signIn(app, staff);

			const otherField = await upload(
				auth,
				multipartFile(PNG, "image/png", "photo"),
			);
			expect(otherField.statusCode).toBe(400);
			const notMultipart = await app.inject({
				method: "POST",
				url: "/admin/assets",
				payload: { file: "x" },
				...auth,
			});
			expect(notMultipart.statusCode).toBe(400);
		});

		it("needs a session and a CSRF token", async () => {
			const file = multipartFile(PNG, "image/png");
			expect((await upload({}, file)).statusCode).toBe(401);
			const { cookies } = await signIn(app, staff);
			expect((await upload({ cookies }, file)).statusCode).toBe(403);
		});
	});

	describe("DELETE /admin/assets/:id", () => {
		it("removes the record and the file", async () => {
			const auth = await signIn(app, staff);
			const { id, url } = (
				await upload(auth, multipartFile(PNG, "image/png"))
			).json<{ id: string; url: string }>();

			const response = await remove(auth, id);

			expect(response.statusCode).toBe(204);
			expect((await assetsOf(store)).map((row) => row.id)).not.toContain(
				id,
			);
			expect((await fetchUncached(url)).ok).toBe(false);
			expect((await remove(auth, id)).statusCode).toBe(404);
		});

		it("does not reach another store's assets", async () => {
			const { id, url } = (
				await upload(
					await signIn(app, otherOwner),
					multipartFile(PNG, "image/png"),
				)
			).json<{ id: string; url: string }>();

			const response = await remove(await signIn(app, staff), id);

			expect(response.statusCode).toBe(404);
			expect((await assetsOf(otherStore)).map((row) => row.id)).toContain(
				id,
			);
			expect((await fetchUncached(url)).ok).toBe(true);
		});

		it("answers 404 to an id that is not a UUID", async () => {
			const response = await remove(await signIn(app, staff), "x");
			expect(response.statusCode).toBe(404);
		});
	});

	describe("table isolation", () => {
		const insert = (tenant: TestTenant, tenantId = tenant.id) =>
			TenantContext.run(tenant, () =>
				tenantDb.run((tx) =>
					tx
						.insert(assets)
						.values({
							tenantId,
							key: buildObjectKey(tenant.id, "assets", ".png"),
						})
						.returning(),
				),
			);

		it("shows and changes only the current tenant's rows", async () => {
			const [mine] = await insert(store);
			const [theirs] = await insert(otherStore);

			expect((await assetsOf(store)).map((row) => row.id)).toContain(
				mine.id,
			);
			expect((await assetsOf(store)).map((row) => row.id)).not.toContain(
				theirs.id,
			);
			await expect(insert(store, otherStore.id)).rejects.toThrow();
			const deleted = await TenantContext.run(store, () =>
				tenantDb.run((tx) =>
					tx
						.delete(assets)
						.where(eq(assets.id, theirs.id))
						.returning(),
				),
			);
			expect(deleted).toEqual([]);
		});

		it("returns no rows outside a tenant context", async () => {
			const db = app.get<Database>(DATABASE);
			expect(await db.select().from(assets)).toEqual([]);
		});
	});
});
