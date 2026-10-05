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

interface Collection {
	id: string;
	name: string;
	slug: string;
	description: string;
	kind: "manual" | "rule";
	parentId: string | null;
	position: number;
	seoTitle: string | null;
	seoDescription: string | null;
	productIds: string[];
	facetValueIds: string[];
}

// Runs against the real PostgreSQL and Valkey in .env.test. Each test signs in
// to a fresh store, so collection lists start empty.
describe("Collections (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	const users: TestUser[] = [];

	const newStore = async (): Promise<{
		tenant: TestTenant;
		panel: PanelClient;
	}> => {
		const tenant = await fixtures.tenant();
		const user = await fixtures.user();
		users.push(user);
		await fixtures.member(tenant, user, "staff");
		return { tenant, panel: panelClient(app, await signIn(app, user)) };
	};
	const product = async (panel: PanelClient) =>
		(
			await panel.post("/admin/products", {
				name: "Produto",
				variant: {
					sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
					price: 100,
				},
			})
		).json<{ id: string }>().id;
	const collection = async (panel: PanelClient, body: object) => {
		const response = await panel.post("/admin/collections", {
			kind: "manual",
			...body,
		});
		expect(response.statusCode).toBe(201);
		return response.json<Collection>();
	};

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
	});

	afterAll(async () => {
		const sessions = app.get(SessionService);
		for (const user of users) {
			await sessions.destroyAllForUser(user.id);
		}
		await fixtures.close();
		await app.close();
	});

	it("creates manual collections in a tree and shows them to the store", async () => {
		const { tenant, panel } = await newStore();

		const clothes = await collection(panel, {
			name: "Roupas",
			description: "Tudo para vestir.",
			seoTitle: "Roupas | Loja",
			seoDescription: "Roupas de algodão.",
		});
		expect(clothes).toEqual({
			id: expect.any(String),
			name: "Roupas",
			slug: "roupas",
			description: "Tudo para vestir.",
			kind: "manual",
			parentId: null,
			position: 0,
			seoTitle: "Roupas | Loja",
			seoDescription: "Roupas de algodão.",
			productIds: [],
			facetValueIds: [],
		});
		const shirts = await collection(panel, {
			name: "Camisetas",
			parentId: clothes.id,
		});
		const shoes = await collection(panel, { name: "Calçados" });
		expect(shirts).toMatchObject({ parentId: clothes.id, position: 0 });
		expect(shoes).toMatchObject({ parentId: null, position: 1 });

		const store = storeClient(app, tenant);
		expect((await store("/store/collections")).json()).toEqual([
			{
				id: clothes.id,
				name: "Roupas",
				slug: "roupas",
				parentId: null,
				position: 0,
			},
			{
				id: shoes.id,
				name: "Calçados",
				slug: "calcados",
				parentId: null,
				position: 1,
			},
			{
				id: shirts.id,
				name: "Camisetas",
				slug: "camisetas",
				parentId: clothes.id,
				position: 0,
			},
		]);
		expect((await store("/store/collections/roupas")).json()).toEqual({
			id: clothes.id,
			name: "Roupas",
			slug: "roupas",
			description: "Tudo para vestir.",
			parentId: null,
			seoTitle: "Roupas | Loja",
			seoDescription: "Roupas de algodão.",
		});
		expect((await store("/store/collections/nope")).statusCode).toBe(404);
	});

	it("reorders siblings with the full list of their ids", async () => {
		const { panel } = await newStore();
		const [a, b, c] = [
			await collection(panel, { name: "A" }),
			await collection(panel, { name: "B" }),
			await collection(panel, { name: "C" }),
		];

		const response = await panel.put("/admin/collections/order", {
			parentId: null,
			collectionIds: [c.id, a.id, b.id],
		});

		expect(response.statusCode).toBe(200);
		expect(
			response.json<Collection[]>().map((x) => [x.name, x.position]),
		).toEqual([
			["C", 0],
			["A", 1],
			["B", 2],
		]);
		for (const collectionIds of [
			[a.id, b.id],
			[a.id, b.id, c.id, c.id],
			[a.id, b.id, crypto.randomUUID()],
		]) {
			expect(
				(
					await panel.put("/admin/collections/order", {
						parentId: null,
						collectionIds,
					})
				).statusCode,
			).toBe(400);
		}
	});

	it("moves a collection to the end of its new parent and refuses cycles", async () => {
		const { panel } = await newStore();
		const parent = await collection(panel, { name: "Pai" });
		const child = await collection(panel, {
			name: "Filho",
			parentId: parent.id,
		});
		const other = await collection(panel, { name: "Outro" });

		const moved = await panel.patch(`/admin/collections/${other.id}`, {
			parentId: parent.id,
		});
		expect(moved.json()).toMatchObject({
			parentId: parent.id,
			position: 1,
		});

		expect(
			(
				await panel.patch(`/admin/collections/${parent.id}`, {
					parentId: child.id,
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await panel.patch(`/admin/collections/${parent.id}`, {
					parentId: parent.id,
				})
			).statusCode,
		).toBe(400);
		expect(
			(await panel.delete(`/admin/collections/${parent.id}`)).statusCode,
		).toBe(409);
		expect(
			(await panel.delete(`/admin/collections/${child.id}`)).statusCode,
		).toBe(204);
	});

	it("sets a manual collection's products in order", async () => {
		const { panel } = await newStore();
		const [first, second] = [await product(panel), await product(panel)];
		const featured = await collection(panel, { name: "Destaques" });

		const response = await panel.put(
			`/admin/collections/${featured.id}/products`,
			{
				productIds: [second, first],
			},
		);

		expect(response.statusCode).toBe(200);
		expect(response.json<Collection>().productIds).toEqual([second, first]);
		expect(
			(
				await panel.put(`/admin/collections/${featured.id}/products`, {
					productIds: [crypto.randomUUID()],
				})
			).statusCode,
		).toBe(400);
	});

	it("keeps rule collections to facet values", async () => {
		const { panel } = await newStore();
		const facet = (
			await panel.post("/admin/facets", {
				name: "Marca",
				values: ["Aurora"],
			})
		).json<{
			id: string;
			values: { id: string }[];
		}>();
		const rule = await collection(panel, {
			name: "Aurora",
			kind: "rule",
			facetValueIds: [facet.values[0].id],
		});
		expect(rule).toMatchObject({
			kind: "rule",
			facetValueIds: [facet.values[0].id],
			productIds: [],
		});

		expect(
			(
				await panel.put(`/admin/collections/${rule.id}/products`, {
					productIds: [],
				})
			).statusCode,
		).toBe(409);
		expect(
			(
				await panel.post("/admin/collections", {
					name: "x",
					kind: "rule",
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await panel.post("/admin/collections", {
					name: "x",
					kind: "manual",
					facetValueIds: [facet.values[0].id],
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await panel.patch(`/admin/collections/${rule.id}`, {
					kind: "manual",
				})
			).statusCode,
		).toBe(400);

		// The rule's facet value, and its facet, stay while the rule uses them.
		expect(
			(await panel.delete(`/admin/facet-values/${facet.values[0].id}`))
				.statusCode,
		).toBe(409);
		expect(
			(await panel.delete(`/admin/facets/${facet.id}`)).statusCode,
		).toBe(409);
	});

	it("keeps slugs unique per store and stays inside the store", async () => {
		const { panel } = await newStore();
		const { panel: otherPanel } = await newStore();
		const mine = await collection(panel, { name: "Promo" });

		// A slug sent and taken is refused; one made from the name gets a suffix.
		expect(
			(
				await panel.post("/admin/collections", {
					name: "Promo",
					slug: "promo",
					kind: "manual",
				})
			).statusCode,
		).toBe(409);
		expect((await collection(panel, { name: "Promo" })).slug).toBe(
			"promo-2",
		);
		expect(
			(
				await otherPanel.post("/admin/collections", {
					name: "Promo",
					slug: "promo",
					kind: "manual",
				})
			).statusCode,
		).toBe(201);
		expect(
			(await otherPanel.get(`/admin/collections/${mine.id}`)).statusCode,
		).toBe(404);
		expect(
			(
				await otherPanel.post("/admin/collections", {
					name: "Sub",
					kind: "manual",
					parentId: mine.id,
				})
			).statusCode,
		).toBe(400);
		expect(
			(await otherPanel.delete(`/admin/collections/${mine.id}`))
				.statusCode,
		).toBe(404);
	});
});
