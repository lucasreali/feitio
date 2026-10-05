import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	Fixtures,
	type PanelClient,
	panelClient,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface Method {
	id: string;
	name: string;
	kind: string;
	config: Record<string, unknown>;
	enabled: boolean;
}

// Runs against the real PostgreSQL and Valkey in .env.test.
describe("Shipping methods panel routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let staffPanel: PanelClient;
	let otherPanel: PanelClient;

	const name = (prefix: string) =>
		`${prefix} ${crypto.randomUUID().slice(0, 8)}`;
	const create = async (body: Record<string, unknown>) => {
		const response = await panel.post("/admin/shipping-methods", body);
		expect(response.statusCode).toBe(201);
		return response.json<Method>();
	};

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		[owner, staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, owner, "owner");
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		staffPanel = panelClient(app, await signIn(app, staff));
		otherPanel = panelClient(app, await signIn(app, otherOwner));
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [owner, staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	describe("POST /admin/shipping-methods", () => {
		it("creates methods of each kind, with the settings their kind checked", async () => {
			const sedex = name("Sedex");
			expect(
				await create({
					name: ` ${sedex} `,
					kind: "fixed",
					config: { price: 2500, freeAbove: 30000 },
				}),
			).toEqual({
				id: expect.any(String),
				name: sedex,
				kind: "fixed",
				config: { price: 2500, freeAbove: 30000, deliveryDays: null },
				enabled: true,
			});
			expect(
				await create({
					name: name("PAC"),
					kind: "melhor_envio",
					config: { serviceId: 1, originCep: "96020-360" },
					enabled: false,
				}),
			).toMatchObject({
				config: { serviceId: 1, originCep: "96020360" },
				enabled: false,
			});
			expect(
				(await create({ name: name("Retirada"), kind: "pickup" }))
					.config,
			).toEqual({});
		});

		it.each([
			{ kind: "fixed", config: { price: 100 } },
			{ name: "x", kind: "drone" },
			{ name: "x", kind: "fixed", config: { price: -1 } },
			{ name: "x", kind: "melhor_envio", config: { serviceId: 1 } },
		])("answers 400 to %j", async (body) => {
			expect(
				(await panel.post("/admin/shipping-methods", body)).statusCode,
			).toBe(400);
		});

		it("keeps names unique in the store, not across stores", async () => {
			const taken = name("Moto");
			await create({ name: taken, kind: "pickup" });
			expect(
				(
					await panel.post("/admin/shipping-methods", {
						name: taken,
						kind: "pickup",
					})
				).statusCode,
			).toBe(409);
			expect(
				(
					await otherPanel.post("/admin/shipping-methods", {
						name: taken,
						kind: "pickup",
					})
				).statusCode,
			).toBe(201);
		});

		it("is for owners only", async () => {
			expect(
				(
					await staffPanel.post("/admin/shipping-methods", {
						name: name("x"),
						kind: "pickup",
					})
				).statusCode,
			).toBe(403);
		});
	});

	describe("GET /admin/shipping-methods", () => {
		it("lists the store's methods by name, also to the staff", async () => {
			const methods = (
				await staffPanel.get("/admin/shipping-methods")
			).json<Method[]>();
			expect(methods.length).toBeGreaterThan(0);
			expect(methods.map((m) => m.name)).toEqual(
				methods.map((m) => m.name).sort((a, b) => a.localeCompare(b)),
			);
			const others = (
				await otherPanel.get("/admin/shipping-methods")
			).json<Method[]>();
			expect(
				others.some((other) => methods.some((m) => m.id === other.id)),
			).toBe(false);
		});
	});

	describe("PATCH /admin/shipping-methods/:id", () => {
		it("renames, disables and replaces the settings, checked against the kind", async () => {
			const method = await create({
				name: name("Sedex"),
				kind: "fixed",
				config: { price: 2500 },
			});
			const renamed = name("Sedex 10");

			const response = await panel.patch(
				`/admin/shipping-methods/${method.id}`,
				{ name: renamed, enabled: false, config: { price: 3000 } },
			);

			expect(response.statusCode).toBe(200);
			expect(response.json<Method>()).toEqual({
				...method,
				name: renamed,
				enabled: false,
				config: { price: 3000, freeAbove: null, deliveryDays: null },
			});
			expect(
				(
					await panel.patch(`/admin/shipping-methods/${method.id}`, {
						config: { serviceId: 1, originCep: "96020360" },
					})
				).statusCode,
			).toBe(400);
			expect(
				(
					await panel.patch(`/admin/shipping-methods/${method.id}`, {
						kind: "pickup",
					})
				).statusCode,
			).toBe(400);
		});

		it("answers 404 to another store's method, and 403 to the staff", async () => {
			const method = await create({ name: name("x"), kind: "pickup" });
			expect(
				(
					await otherPanel.patch(
						`/admin/shipping-methods/${method.id}`,
						{
							enabled: false,
						},
					)
				).statusCode,
			).toBe(404);
			expect(
				(
					await staffPanel.patch(
						`/admin/shipping-methods/${method.id}`,
						{
							enabled: false,
						},
					)
				).statusCode,
			).toBe(403);
		});
	});
});
