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

interface VariantStock {
	variantId: string;
	trackStock: boolean;
	allowBackorder: boolean;
	lowStockThreshold: number | null;
	available: number;
	reserved: number;
	low: boolean;
}

interface Product {
	id: string;
	variants: { id: string; sku: string }[];
}

// Runs against the real PostgreSQL and Valkey in .env.test.
describe("Stock panel routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	/** A new product; answers its only variant. */
	const variant = async (client: PanelClient = panel) => {
		const response = await client.post("/admin/products", {
			name: "Camiseta",
			variant: {
				sku: `SKU-${crypto.randomUUID().slice(0, 8)}`,
				price: 4990,
			},
		});
		expect(response.statusCode).toBe(201);
		const product = response.json<Product>();
		return { productId: product.id, ...product.variants[0] };
	};
	const adjust = (id: string, quantity: number, client = panel) =>
		client.post(`/admin/variants/${id}/stock/adjustments`, { quantity });

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

	describe("GET /admin/variants/:id/stock", () => {
		it("shows a new variant tracked, with nothing in stock", async () => {
			const { id } = await variant();

			const response = await panel.get(`/admin/variants/${id}/stock`);

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				variantId: id,
				trackStock: true,
				allowBackorder: false,
				lowStockThreshold: null,
				available: 0,
				reserved: 0,
				low: false,
			});
		});

		it.each(["not-an-id", "0199d5a4-0000-7000-8000-000000000000"])(
			"answers 404 to %s",
			async (id) => {
				expect(
					(await panel.get(`/admin/variants/${id}/stock`)).statusCode,
				).toBe(404);
			},
		);
	});

	describe("POST /admin/variants/:id/stock/adjustments", () => {
		it("adds and removes units, never below zero", async () => {
			const { id } = await variant();

			expect((await adjust(id, 5)).statusCode).toBe(201);
			const response = await adjust(id, -2);
			expect(response.json<VariantStock>()).toMatchObject({
				available: 3,
				reserved: 0,
			});
			expect((await adjust(id, -4)).statusCode).toBe(409);
			expect(
				(await panel.get(`/admin/variants/${id}/stock`)).json(),
			).toMatchObject({ available: 3 });
		});

		it.each([{}, { quantity: 0 }, { quantity: 1.5 }, { quantity: "2" }])(
			"answers 400 to %j",
			async (body) => {
				const { id } = await variant();
				expect(
					(
						await panel.post(
							`/admin/variants/${id}/stock/adjustments`,
							body,
						)
					).statusCode,
				).toBe(400);
			},
		);
	});

	describe("PATCH /admin/variants/:id/stock", () => {
		it("changes the policy and warns at the low stock threshold", async () => {
			const { id } = await variant();
			await adjust(id, 3);

			const response = await panel.patch(`/admin/variants/${id}/stock`, {
				allowBackorder: true,
				lowStockThreshold: 3,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				trackStock: true,
				allowBackorder: true,
				lowStockThreshold: 3,
				available: 3,
				low: true,
			});
			await adjust(id, 1);
			expect(
				(await panel.get(`/admin/variants/${id}/stock`)).json(),
			).toMatchObject({ low: false });
			const untracked = await panel.patch(`/admin/variants/${id}/stock`, {
				trackStock: false,
				lowStockThreshold: 10,
			});
			expect(untracked.json()).toMatchObject({ low: false });
		});

		it("answers 400 to an invalid policy", async () => {
			const { id } = await variant();
			expect(
				(
					await panel.patch(`/admin/variants/${id}/stock`, {
						trackStock: "no",
					})
				).statusCode,
			).toBe(400);
		});
	});

	describe("GET /admin/variants/:id/stock/movements", () => {
		it("lists the variant's movements, newest first, by page", async () => {
			const { id } = await variant();
			for (const quantity of [5, -1, 2]) {
				await adjust(id, quantity);
			}

			const response = await panel.get(
				`/admin/variants/${id}/stock/movements?pageSize=2`,
			);

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				items: [
					{
						id: expect.any(String),
						kind: "adjustment",
						quantity: 2,
						createdAt: expect.any(String),
					},
					{
						id: expect.any(String),
						kind: "adjustment",
						quantity: -1,
						createdAt: expect.any(String),
					},
				],
				page: 1,
				pageSize: 2,
				total: 3,
			});
		});
	});

	describe("GET /admin/stock/low", () => {
		it("lists tracked variants at or below their threshold, fewest units first", async () => {
			// One at a time: concurrent products with the same name race for the slug.
			const [empty, few, plenty, untracked, archived] = [
				await variant(),
				await variant(),
				await variant(),
				await variant(),
				await variant(),
			];
			await adjust(few.id, 2);
			await adjust(plenty.id, 10);
			for (const v of [empty, few, plenty, untracked, archived]) {
				await panel.patch(`/admin/variants/${v.id}/stock`, {
					lowStockThreshold: 5,
				});
			}
			await panel.patch(`/admin/variants/${untracked.id}/stock`, {
				trackStock: false,
			});
			await panel.patch(`/admin/products/${archived.productId}`, {
				status: "archived",
			});

			const response = await panel.get("/admin/stock/low");

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				items: [
					{
						variantId: empty.id,
						sku: empty.sku,
						productId: empty.productId,
						productName: "Camiseta",
						available: 0,
						reserved: 0,
						lowStockThreshold: 5,
					},
					{
						variantId: few.id,
						sku: few.sku,
						productId: few.productId,
						productName: "Camiseta",
						available: 2,
						reserved: 0,
						lowStockThreshold: 5,
					},
				],
				page: 1,
				pageSize: 24,
				total: 2,
			});
			expect(
				(await otherPanel.get("/admin/stock/low")).json(),
			).toMatchObject({ items: [], total: 0 });
		});
	});

	it("keeps one store's stock from another", async () => {
		const { id } = await variant();
		const mine = await variant(otherPanel);

		for (const response of [
			await otherPanel.get(`/admin/variants/${id}/stock`),
			await otherPanel.patch(`/admin/variants/${id}/stock`, {
				trackStock: false,
			}),
			await adjust(id, 1, otherPanel),
			await otherPanel.get(`/admin/variants/${id}/stock/movements`),
			await panel.get(`/admin/variants/${mine.id}/stock`),
		]) {
			expect(response.statusCode).toBe(404);
		}
		expect(
			(await panel.get(`/admin/variants/${id}/stock`)).json(),
		).toMatchObject({ trackStock: true, available: 0 });
	});
});
