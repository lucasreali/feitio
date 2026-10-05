import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { assets } from "../../src/database/schemas/assets.js";
import { SessionService } from "../../src/session/session.service.js";
import { buildObjectKey } from "../../src/storage/object-key.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../../src/tenancy/tenant-database.js";
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
	values: { id: string; name: string }[];
}

// Runs against the real PostgreSQL and Valkey in .env, on a store of its own.
describe("Store product routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let tenant: TestTenant;
	let otherTenant: TestTenant;
	let user: TestUser;
	let panel: PanelClient;
	let store: (url: string) => ReturnType<NestFastifyApplication["inject"]>;
	const ids: Record<string, string> = {};
	let blue: string;
	let red: string;
	let cotton: string;
	let image: string;

	const names = async (url: string) => {
		const response = await store(url);
		expect(response.statusCode).toBe(200);
		return response
			.json<{ items: { name: string }[] }>()
			.items.map((item) => item.name);
	};

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		otherTenant = await fixtures.tenant();
		user = await fixtures.user();
		await fixtures.member(tenant, user, "owner");
		panel = panelClient(app, await signIn(app, user));
		store = storeClient(app, tenant);

		const color = (
			await panel.post("/admin/facets", {
				name: "Cor",
				values: ["Azul", "Vermelho"],
			})
		).json<Facet>();
		const material = (
			await panel.post("/admin/facets", {
				name: "Material",
				values: ["Algodão"],
			})
		).json<Facet>();
		[blue, red] = color.values.map((value) => value.id);
		cotton = material.values[0].id;
		[{ id: image }] = await TenantContext.run(tenant, () =>
			app.get(TenantDatabase).run((tx) =>
				tx
					.insert(assets)
					.values({
						tenantId: tenant.id,
						key: buildObjectKey(tenant.id, "assets", ".png"),
					})
					.returning({ id: assets.id }),
			),
		);

		// Created oldest first: Camiseta Azul, Camiseta Vermelha, Boné, Rascunho, Antigo.
		const products: [string, string, number, string[], string][] = [
			["Camiseta Azul", "active", 3000, [blue, cotton], "camiseta-azul"],
			[
				"Camiseta Vermelha",
				"active",
				4000,
				[red, cotton],
				"camiseta-vermelha",
			],
			["Boné", "active", 1500, [blue], "bone"],
			["Rascunho", "draft", 100, [blue, cotton], "rascunho"],
			["Antigo", "archived", 100, [blue, cotton], "antigo"],
		];
		for (const [name, status, price, facetValueIds, slug] of products) {
			const { id } = (
				await panel.post("/admin/products", {
					name,
					slug,
					variant: { sku: `${slug}-1`, price },
				})
			).json<{ id: string }>();
			await panel.patch(`/admin/products/${id}`, {
				status,
				facetValueIds,
			});
			ids[name] = id;
		}
		// A cheaper size makes 2500 the lowest price of Camiseta Azul.
		const sizes = (
			await panel.post(
				`/admin/products/${ids["Camiseta Azul"]}/option-groups`,
				{
					name: "Tamanho",
					options: ["P", "M"],
				},
			)
		).json<{ optionGroups: { options: { id: string }[] }[] }>();
		const added = await panel.post(
			`/admin/products/${ids["Camiseta Azul"]}/variants`,
			{
				sku: "camiseta-azul-2",
				price: 2500,
				optionIds: [sizes.optionGroups[0].options[1].id],
			},
		);
		expect(added.statusCode).toBe(201);
		await panel.patch(`/admin/products/${ids["Camiseta Azul"]}`, {
			imageIds: [image],
		});

		const featured = (
			await panel.post("/admin/collections", {
				name: "Destaques",
				kind: "manual",
			})
		).json<{
			id: string;
		}>();
		await panel.put(`/admin/collections/${featured.id}/products`, {
			productIds: [
				ids["Camiseta Vermelha"],
				ids.Rascunho,
				ids["Camiseta Azul"],
			],
		});
		await panel.post("/admin/collections", {
			name: "Algodão",
			kind: "rule",
			facetValueIds: [cotton],
		});
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(user.id);
		await fixtures.close();
		await app.close();
	});

	describe("GET /store/products", () => {
		it("lists only active products, newest first, with the lowest price and first image", async () => {
			const response = await store("/store/products");

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				page: 1,
				pageSize: 24,
				total: 3,
				items: [
					{
						id: ids.Boné,
						name: "Boné",
						slug: "bone",
						price: 1500,
						image: null,
					},
					{
						id: ids["Camiseta Vermelha"],
						name: "Camiseta Vermelha",
						slug: "camiseta-vermelha",
						price: 4000,
						image: null,
					},
					{
						id: ids["Camiseta Azul"],
						name: "Camiseta Azul",
						slug: "camiseta-azul",
						price: 2500,
						image: {
							id: image,
							url: expect.stringMatching(/\.png$/),
						},
					},
				],
			});
		});

		it.each([
			["price-asc", ["Boné", "Camiseta Azul", "Camiseta Vermelha"]],
			["price-desc", ["Camiseta Vermelha", "Camiseta Azul", "Boné"]],
			["name", ["Boné", "Camiseta Azul", "Camiseta Vermelha"]],
			["newest", ["Boné", "Camiseta Vermelha", "Camiseta Azul"]],
		])("sorts by %s", async (sort, expected) => {
			expect(await names(`/store/products?sort=${sort}`)).toEqual(
				expected,
			);
		});

		it("lists a manual collection in its order, and a rule collection by its facet values", async () => {
			expect(await names("/store/products?collection=destaques")).toEqual(
				["Camiseta Vermelha", "Camiseta Azul"],
			);
			expect(
				await names(
					"/store/products?collection=destaques&sort=price-asc",
				),
			).toEqual(["Camiseta Azul", "Camiseta Vermelha"]);
			expect(await names("/store/products?collection=algodao")).toEqual([
				"Camiseta Vermelha",
				"Camiseta Azul",
			]);
		});

		it("filters by facet values: any value of a facet, every facet", async () => {
			expect(
				await names(`/store/products?facetValueIds=${blue},${red}`),
			).toEqual(["Boné", "Camiseta Vermelha", "Camiseta Azul"]);
			expect(
				await names(`/store/products?facetValueIds=${blue},${cotton}`),
			).toEqual(["Camiseta Azul"]);
			expect(
				await names(
					`/store/products?collection=algodao&facetValueIds=${red}`,
				),
			).toEqual(["Camiseta Vermelha"]);
		});

		it("pages the results", async () => {
			const response = await store("/store/products?page=2&pageSize=2");
			expect(response.json()).toMatchObject({
				page: 2,
				pageSize: 2,
				total: 3,
				items: [{ name: "Camiseta Azul" }],
			});
		});

		it.each([
			[
				"a position sort without a manual collection",
				"/store/products?sort=position",
				400,
			],
			["an unknown sort", "/store/products?sort=random", 400],
			[
				"an invalid facet value id",
				"/store/products?facetValueIds=x",
				400,
			],
			["a page size of 0", "/store/products?pageSize=0", 400],
			["an unknown collection", "/store/products?collection=nope", 404],
		])("answers %s with %i", async (_case, url, status) => {
			expect((await store(url)).statusCode).toBe(status);
		});

		it("shows nothing to another store", async () => {
			const response = await storeClient(
				app,
				otherTenant,
			)("/store/products");
			expect(response.json()).toMatchObject({ total: 0, items: [] });
		});
	});

	describe("GET /store/products/:slug", () => {
		it("returns an active product with its variants", async () => {
			const response = await store("/store/products/camiseta-azul");

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				id: ids["Camiseta Azul"],
				name: "Camiseta Azul",
				images: [{ id: image }],
				variants: [{ price: 3000 }, { price: 2500 }],
				facetValues: [{ name: "Azul" }, { name: "Algodão" }],
			});
		});

		it("answers 404 to drafts, archived products and other stores' products", async () => {
			expect((await store("/store/products/rascunho")).statusCode).toBe(
				404,
			);
			expect((await store("/store/products/antigo")).statusCode).toBe(
				404,
			);
			expect(
				(
					await storeClient(
						app,
						otherTenant,
					)("/store/products/camiseta-azul")
				).statusCode,
			).toBe(404);
		});
	});
});
