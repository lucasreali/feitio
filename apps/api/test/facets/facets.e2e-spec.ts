import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	Fixtures,
	type PanelClient,
	panelClient,
	signIn,
	startApp,
	storeClient,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface Facet {
	id: string;
	name: string;
	values: { id: string; name: string }[];
}

// Runs against the real PostgreSQL and Valkey in .env.test.
describe("Facets (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		[staff, otherOwner] = await Promise.all([
			fixtures.user(),
			fixtures.user(),
		]);
		await fixtures.member(store, staff, "staff");
		await fixtures.member(otherStore, otherOwner, "owner");
		panel = panelClient(app, await signIn(app, staff));
		otherPanel = panelClient(app, await signIn(app, otherOwner));
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of [staff, otherOwner]) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	it("creates facets with values and lists them to the panel and the store", async () => {
		const created = await panel.post("/admin/facets", {
			name: " Marca ",
			values: ["Aurora", "Brisa"],
		});
		expect(created.statusCode).toBe(201);
		const brand = created.json<Facet>();
		expect(brand).toEqual({
			id: expect.any(String),
			name: "Marca",
			values: [
				{ id: expect.any(String), name: "Aurora" },
				{ id: expect.any(String), name: "Brisa" },
			],
		});
		const material = (
			await panel.post("/admin/facets", { name: "Material" })
		).json<Facet>();

		expect((await panel.get("/admin/facets")).json()).toEqual([
			brand,
			material,
		]);
		expect((await storeClient(app, store)("/store/facets")).json()).toEqual(
			[brand, material],
		);
		expect(
			(await storeClient(app, otherStore)("/store/facets")).json(),
		).toEqual([]);
	});

	it("adds, renames and removes values, and renames and removes facets", async () => {
		const facet = (
			await panel.post("/admin/facets", { name: "Cor", values: ["Azul"] })
		).json<Facet>();
		const [blue] = facet.values;

		const added = await panel.post(`/admin/facets/${facet.id}/values`, {
			name: "Verde",
		});
		expect(added.statusCode).toBe(201);
		const green = added.json<Facet>().values[1];
		expect(green.name).toBe("Verde");
		expect(
			(
				await panel.patch(`/admin/facet-values/${blue.id}`, {
					name: "Azul-claro",
				})
			).json<Facet>().values[0].name,
		).toBe("Azul-claro");
		expect(
			(
				await panel.delete(`/admin/facet-values/${green.id}`)
			).json<Facet>().values,
		).toEqual([{ id: blue.id, name: "Azul-claro" }]);
		expect(
			(
				await panel.patch(`/admin/facets/${facet.id}`, {
					name: "Cores",
				})
			).json<Facet>().name,
		).toBe("Cores");

		expect(
			(await panel.delete(`/admin/facets/${facet.id}`)).statusCode,
		).toBe(204);
		expect(
			(await panel.get("/admin/facets")).json<Facet[]>().map((f) => f.id),
		).not.toContain(facet.id);
	});

	it("keeps names unique: facets per store and values per facet", async () => {
		const name = `Gênero ${Date.now()}`;
		const facet = (
			await panel.post("/admin/facets", { name, values: ["Unissex"] })
		).json<Facet>();

		expect((await panel.post("/admin/facets", { name })).statusCode).toBe(
			409,
		);
		expect(
			(
				await panel.post(`/admin/facets/${facet.id}/values`, {
					name: "Unissex",
				})
			).statusCode,
		).toBe(409);
		expect(
			(
				await panel.post("/admin/facets", {
					name: "x",
					values: ["A", "A"],
				})
			).statusCode,
		).toBe(400);
		expect(
			(await otherPanel.post("/admin/facets", { name })).statusCode,
		).toBe(201);
	});

	it("does not reach another store's facets", async () => {
		const theirs = (
			await otherPanel.post("/admin/facets", {
				name: "Deles",
				values: ["X"],
			})
		).json<Facet>();

		expect(
			(await panel.patch(`/admin/facets/${theirs.id}`, { name: "x" }))
				.statusCode,
		).toBe(404);
		expect(
			(await panel.delete(`/admin/facets/${theirs.id}`)).statusCode,
		).toBe(404);
		expect(
			(
				await panel.post(`/admin/facets/${theirs.id}/values`, {
					name: "x",
				})
			).statusCode,
		).toBe(404);
		expect(
			(await panel.delete(`/admin/facet-values/${theirs.values[0].id}`))
				.statusCode,
		).toBe(404);
	});

	it("answers 400 to invalid bodies", async () => {
		for (const body of [
			{},
			{ name: "" },
			{ name: "x", values: "A" },
			{ name: "x", other: 1 },
		]) {
			expect((await panel.post("/admin/facets", body)).statusCode).toBe(
				400,
			);
		}
	});
});
