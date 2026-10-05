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
	storeEvents,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface Product {
	id: string;
	name: string;
	slug: string;
	description: string;
	status: string;
	seoTitle: string | null;
	seoDescription: string | null;
	images: { id: string; url: string }[];
	optionGroups: {
		id: string;
		name: string;
		options: { id: string; name: string }[];
	}[];
	variants: {
		id: string;
		sku: string;
		price: number;
		image: { id: string; url: string } | null;
		optionIds: string[];
	}[];
	facetValues: {
		id: string;
		name: string;
		facetId: string;
		facetName: string;
	}[];
}

// Runs against the real PostgreSQL and Valkey in .env.
describe("Product panel routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	/** Records an asset row; the file itself is not needed here. */
	const asset = (tenant: TestTenant) =>
		TenantContext.run(tenant, () =>
			app.get(TenantDatabase).run((tx) =>
				tx
					.insert(assets)
					.values({
						tenantId: tenant.id,
						key: buildObjectKey(tenant.id, "assets", ".png"),
					})
					.returning({ id: assets.id }),
			),
		).then(([row]) => row.id);
	const sku = () => `SKU-${crypto.randomUUID().slice(0, 8)}`;
	const create = async (client: PanelClient, body: object = {}) => {
		const response = await client.post("/admin/products", {
			name: "Camiseta Básica",
			variant: { sku: sku(), price: 4990 },
			...body,
		});
		expect(response.statusCode).toBe(201);
		return response.json<Product>();
	};

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

	describe("POST /admin/products", () => {
		it("creates a draft with its first variant and a slug from the name", async () => {
			const variantSku = sku();
			const response = await panel.post("/admin/products", {
				name: "  Camiseta Básica Azul ",
				description: "Algodão.",
				seoTitle: "Camiseta azul",
				variant: { sku: variantSku, price: 4990 },
			});

			expect(response.statusCode).toBe(201);
			const product = response.json<Product>();
			expect(product).toMatchObject({
				name: "Camiseta Básica Azul",
				slug: expect.stringMatching(/^camiseta-basica-azul/),
				description: "Algodão.",
				status: "draft",
				seoTitle: "Camiseta azul",
				seoDescription: null,
				images: [],
				optionGroups: [],
				facetValues: [],
			});
			expect(product.variants).toEqual([
				{
					id: expect.any(String),
					sku: variantSku,
					price: 4990,
					image: null,
					optionIds: [],
				},
			]);
			expect(
				(await panel.get(`/admin/products/${product.id}`)).json(),
			).toEqual(product);
		});

		it("keeps slugs and SKUs unique per store, not across stores", async () => {
			const taken = await create(panel, { slug: `taken-${Date.now()}` });

			expect(
				(
					await panel.post("/admin/products", {
						name: "Other",
						slug: taken.slug,
						variant: { sku: sku(), price: 1 },
					})
				).statusCode,
			).toBe(409);
			expect(
				(
					await panel.post("/admin/products", {
						name: "Other",
						variant: { sku: taken.variants[0].sku, price: 1 },
					})
				).statusCode,
			).toBe(409);
			const elsewhere = await create(otherPanel, {
				slug: taken.slug,
				variant: { sku: taken.variants[0].sku, price: 1 },
			});
			expect(elsewhere.slug).toBe(taken.slug);
		});

		it.each([
			["no variant", { name: "x" }],
			[
				"a negative price",
				{ name: "x", variant: { sku: "A", price: -1 } },
			],
			[
				"a price in reais",
				{ name: "x", variant: { sku: "A", price: 49.9 } },
			],
			[
				"an invalid SKU",
				{ name: "x", variant: { sku: "A B", price: 1 } },
			],
			[
				"an invalid slug",
				{ name: "x", slug: "Não", variant: { sku: "A", price: 1 } },
			],
			[
				"a status",
				{
					name: "x",
					status: "active",
					variant: { sku: "A", price: 1 },
				},
			],
			["an empty name", { name: " ", variant: { sku: "A", price: 1 } }],
		])("answers 400 to %s", async (_case, body) => {
			expect((await panel.post("/admin/products", body)).statusCode).toBe(
				400,
			);
		});

		it("publishes product.created with the new product", async () => {
			const product = await create(panel);

			expect((await storeEvents(app, store)).at(-1)).toEqual({
				type: "product.created",
				payload: { productId: product.id },
				dispatchedAt: null,
			});
		});
	});

	describe("PATCH /admin/products/:id", () => {
		it("edits the fields sent, archives, and sets images and facet values in order", async () => {
			const product = await create(panel);
			const [first, second] = [await asset(store), await asset(store)];
			const facet = (
				await panel.post("/admin/facets", {
					name: `Marca ${Date.now()}`,
					values: ["Aurora", "Brisa"],
				})
			).json<{ values: { id: string }[] }>();

			const response = await panel.patch(
				`/admin/products/${product.id}`,
				{
					name: "Camiseta Nova",
					status: "archived",
					seoDescription: "Descrição para buscadores.",
					imageIds: [second, first],
					facetValueIds: [facet.values[1].id],
				},
			);

			expect(response.statusCode).toBe(200);
			const edited = response.json<Product>();
			expect(edited).toMatchObject({
				name: "Camiseta Nova",
				slug: product.slug,
				status: "archived",
				seoDescription: "Descrição para buscadores.",
			});
			expect(edited.images.map((image) => image.id)).toEqual([
				second,
				first,
			]);
			expect(edited.images[0].url).toMatch(/\/assets\/[0-9a-f-]+\.png$/);
			expect(edited.facetValues).toEqual([
				{
					id: facet.values[1].id,
					name: "Brisa",
					facetId: expect.any(String),
					facetName: expect.stringMatching(/^Marca/),
				},
			]);

			const cleared = await panel.patch(`/admin/products/${product.id}`, {
				imageIds: [],
				seoDescription: null,
			});
			expect(cleared.json()).toMatchObject({
				images: [],
				seoDescription: null,
			});
		});

		it("answers 400 to another store's asset and keeps the product", async () => {
			const product = await create(panel);
			const response = await panel.patch(
				`/admin/products/${product.id}`,
				{
					imageIds: [await asset(otherStore)],
				},
			);

			expect(response.statusCode).toBe(400);
			expect(
				(await panel.get(`/admin/products/${product.id}`)).json()
					.images,
			).toEqual([]);
		});

		it("answers 404 to another store's product", async () => {
			const theirs = await create(otherPanel);
			expect(
				(
					await panel.patch(`/admin/products/${theirs.id}`, {
						name: "x",
					})
				).statusCode,
			).toBe(404);
			expect(
				(await panel.get(`/admin/products/${theirs.id}`)).statusCode,
			).toBe(404);
			expect(
				(await panel.get("/admin/products/not-an-id")).statusCode,
			).toBe(404);
		});
	});

	describe("GET /admin/products", () => {
		it("pages the store's products, newest first, and filters by status", async () => {
			const tenant = await fixtures.tenant();
			const user = await fixtures.user();
			await fixtures.member(tenant, user, "owner");
			const client = panelClient(app, await signIn(app, user));
			const created = [];
			for (const name of ["A", "B", "C"]) {
				created.push(await create(client, { name }));
			}
			await client.patch(`/admin/products/${created[0].id}`, {
				status: "active",
			});

			const page = await client.get("/admin/products?page=1&pageSize=2");
			expect(page.statusCode).toBe(200);
			expect(page.json()).toMatchObject({
				page: 1,
				pageSize: 2,
				total: 3,
				items: [
					{
						id: created[2].id,
						name: "C",
						status: "draft",
						price: 4990,
					},
					{ id: created[1].id, name: "B" },
				],
			});
			expect(
				(await client.get("/admin/products?status=active")).json()
					.items,
			).toEqual([expect.objectContaining({ id: created[0].id })]);
			expect(
				(await client.get("/admin/products?pageSize=1000")).statusCode,
			).toBe(400);
			expect(
				(await client.get("/admin/products?status=x")).statusCode,
			).toBe(400);
		});
	});

	describe("options and variants", () => {
		it("builds a product with sizes and keeps each variant's combination unique", async () => {
			const product = await create(panel);
			const [first] = product.variants;

			// A new group gives its first option to the variants that exist.
			const sized = (
				await panel.post(
					`/admin/products/${product.id}/option-groups`,
					{
						name: "Tamanho",
						options: ["P", "M"],
					},
				)
			).json<Product>();
			const [size] = sized.optionGroups;
			const [small, medium] = size.options;
			expect(size).toMatchObject({
				name: "Tamanho",
				options: [{ name: "P" }, { name: "M" }],
			});
			expect(sized.variants).toEqual([
				expect.objectContaining({
					id: first.id,
					optionIds: [small.id],
				}),
			]);

			const created = await panel.post(
				`/admin/products/${product.id}/variants`,
				{
					sku: sku(),
					price: 5290,
					optionIds: [medium.id],
				},
			);
			expect(created.statusCode).toBe(201);
			const second = created.json<Product>().variants[1];
			expect(second).toMatchObject({
				price: 5290,
				optionIds: [medium.id],
			});

			expect(
				(
					await panel.post(`/admin/products/${product.id}/variants`, {
						sku: sku(),
						price: 1,
						optionIds: [small.id],
					})
				).statusCode,
			).toBe(409);
			expect(
				(
					await panel.post(`/admin/products/${product.id}/variants`, {
						sku: sku(),
						price: 1,
						optionIds: [],
					})
				).statusCode,
			).toBe(400);
			const other = await create(panel);
			expect(
				(
					await panel.post(`/admin/products/${other.id}/variants`, {
						sku: sku(),
						price: 1,
						optionIds: [medium.id],
					})
				).statusCode,
			).toBe(400);

			// Options in use stay; unused ones can go.
			const large = (
				await panel.post(`/admin/option-groups/${size.id}/options`, {
					name: "G",
				})
			).json<Product>().optionGroups[0].options[2];
			expect(
				(await panel.delete(`/admin/options/${medium.id}`)).statusCode,
			).toBe(409);
			expect(
				(await panel.delete(`/admin/options/${large.id}`)).statusCode,
			).toBe(200);
			expect(
				(
					await panel.patch(`/admin/options/${medium.id}`, {
						name: "Médio",
					})
				).json<Product>().optionGroups[0].options[1].name,
			).toBe("Médio");
			expect(
				(
					await panel.patch(`/admin/option-groups/${size.id}`, {
						name: "Size",
					})
				).json<Product>().optionGroups[0].name,
			).toBe("Size");

			// The group cannot go while variants differ in it.
			expect(
				(await panel.delete(`/admin/option-groups/${size.id}`))
					.statusCode,
			).toBe(409);
			const withoutSecond = await panel.delete(
				`/admin/variants/${second.id}`,
			);
			expect(
				withoutSecond.json<Product>().variants.map((v) => v.id),
			).toEqual([first.id]);
			expect(
				(await panel.delete(`/admin/variants/${first.id}`)).statusCode,
			).toBe(409);
			const ungrouped = (
				await panel.delete(`/admin/option-groups/${size.id}`)
			).json<Product>();
			expect(ungrouped.optionGroups).toEqual([]);
			expect(ungrouped.variants).toEqual([
				expect.objectContaining({ id: first.id, optionIds: [] }),
			]);
		});

		it("edits a variant's SKU, price and image", async () => {
			const product = await create(panel);
			const image = await asset(store);
			const [variant] = product.variants;
			const newSku = sku();

			const response = await panel.patch(
				`/admin/variants/${variant.id}`,
				{
					sku: newSku,
					price: 0,
					imageId: image,
				},
			);

			expect(response.statusCode).toBe(200);
			expect(response.json<Product>().variants[0]).toMatchObject({
				id: variant.id,
				sku: newSku,
				price: 0,
				image: { id: image },
			});
			expect(
				(
					await panel.patch(`/admin/variants/${variant.id}`, {
						imageId: null,
					})
				).json<Product>().variants[0].image,
			).toBeNull();
			expect(
				(
					await panel.patch(`/admin/variants/${variant.id}`, {
						optionIds: [],
					})
				).statusCode,
			).toBe(400);
		});

		it("keeps an asset that a product uses", async () => {
			const product = await create(panel);
			const image = await asset(store);
			await panel.patch(`/admin/products/${product.id}`, {
				imageIds: [image],
			});

			expect(
				(await panel.delete(`/admin/assets/${image}`)).statusCode,
			).toBe(409);
		});

		it("does not reach another store's options and variants", async () => {
			const theirs = await create(otherPanel);
			const group = (
				await otherPanel.post(
					`/admin/products/${theirs.id}/option-groups`,
					{
						name: "Cor",
						options: ["Azul"],
					},
				)
			).json<Product>().optionGroups[0];

			expect(
				(
					await panel.patch(`/admin/option-groups/${group.id}`, {
						name: "x",
					})
				).statusCode,
			).toBe(404);
			expect(
				(await panel.delete(`/admin/options/${group.options[0].id}`))
					.statusCode,
			).toBe(404);
			expect(
				(
					await panel.patch(
						`/admin/variants/${theirs.variants[0].id}`,
						{ price: 1 },
					)
				).statusCode,
			).toBe(404);
			expect(
				(
					await panel.post(`/admin/products/${theirs.id}/variants`, {
						sku: sku(),
						price: 1,
						optionIds: [group.options[0].id],
					})
				).statusCode,
			).toBe(404);
		});
	});

	it("needs a session", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/admin/products",
		});
		expect(response.statusCode).toBe(401);
	});
});
