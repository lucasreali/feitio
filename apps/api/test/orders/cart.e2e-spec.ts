import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { SessionService } from "../../src/session/session.service.js";
import {
	type CartClient,
	cartClient,
	Fixtures,
	type PanelClient,
	panelClient,
	sellableVariant,
	signIn,
	startApp,
	type TestTenant,
	type TestUser,
} from "../fixtures.js";

interface Cart {
	state: string;
	number: number | null;
	lines: {
		id: string;
		variantId: string | null;
		productName: string;
		sku: string;
		quantity: number;
		unitPrice: number;
		total: number;
	}[];
	subtotal: number;
	discount: number;
	shipping: number;
	total: number;
}

// Runs against the real PostgreSQL and Valkey in .env.test.
// Most tests build orders through the API, a remote round trip per step.
describe("Store cart routes (e2e)", { timeout: 30_000 }, () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;
	let cart: CartClient;
	let otherCart: CartClient;

	/** A new cart; answers its token. */
	const newCart = async (client = cart) => {
		const response = await client("POST", "/store/cart");
		expect(response.statusCode).toBe(201);
		return response.json<{ token: string }>().token;
	};
	const add = (token: string, variantId: string, quantity = 1) =>
		cart("POST", "/store/cart/lines", {
			token,
			payload: { variantId, quantity },
		});

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		owner = await fixtures.user();
		await fixtures.member(store, owner, "owner");
		panel = panelClient(app, await signIn(app, owner));
		cart = cartClient(app, store);
		otherCart = cartClient(app, otherStore);
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(owner.id);
		await fixtures.close();
		await app.close();
	});

	describe("POST /store/cart", () => {
		it("starts an empty cart and answers its token once", async () => {
			const response = await cart("POST", "/store/cart");

			expect(response.statusCode).toBe(201);
			const { token, cart: created } = response.json<{
				token: string;
				cart: Cart;
			}>();
			expect(token).toMatch(/^[\w-]{43}$/);
			expect(created).toMatchObject({
				state: "cart",
				number: null,
				lines: [],
				subtotal: 0,
				discount: 0,
				shipping: 0,
				total: 0,
				shippingMethod: null,
				trackingCode: null,
			});
			expect(
				(await cart("GET", "/store/cart", { token })).json(),
			).toEqual(created);
		});
	});

	describe("GET /store/cart", () => {
		it.each([
			["no token", undefined],
			["an unknown token", "x".repeat(43)],
			["a malformed token", "not a token"],
		])("answers 404 to %s", async (_case, token) => {
			expect(
				(await cart("GET", "/store/cart", { token })).statusCode,
			).toBe(404);
		});

		it("answers 404 to another store's cart", async () => {
			const token = await newCart(otherCart);
			expect(
				(await cart("GET", "/store/cart", { token })).statusCode,
			).toBe(404);
		});
	});

	describe("POST /store/cart/lines", () => {
		it("adds a variant at the catalog's price and sums the totals", async () => {
			const shirt = await sellableVariant(panel, {
				price: 4990,
				name: "Camiseta",
			});
			const cap = await sellableVariant(panel, {
				price: 1500,
				name: "Boné",
			});
			const token = await newCart();

			expect((await add(token, shirt.variantId, 2)).statusCode).toBe(201);
			const response = await add(token, cap.variantId);

			expect(response.json<Cart>()).toMatchObject({
				lines: [
					{
						variantId: shirt.variantId,
						productName: "Camiseta",
						sku: shirt.sku,
						quantity: 2,
						unitPrice: 4990,
						total: 9980,
					},
					{
						variantId: cap.variantId,
						productName: "Boné",
						quantity: 1,
						unitPrice: 1500,
						total: 1500,
					},
				],
				subtotal: 11480,
				discount: 0,
				shipping: 0,
				total: 11480,
			});
		});

		it("adds to the line the variant already has", async () => {
			const { variantId } = await sellableVariant(panel);
			const token = await newCart();
			await add(token, variantId, 2);

			const response = await add(token, variantId, 3);

			expect(response.json<Cart>().lines).toMatchObject([
				{ variantId, quantity: 5 },
			]);
		});

		it.each([
			[
				"a price",
				(variantId: string) => ({
					variantId,
					quantity: 1,
					unitPrice: 1,
				}),
			],
			["no quantity", (variantId: string) => ({ variantId })],
			["0 units", (variantId: string) => ({ variantId, quantity: 0 })],
			[
				"1.5 units",
				(variantId: string) => ({ variantId, quantity: 1.5 }),
			],
			[
				"1000 units",
				(variantId: string) => ({ variantId, quantity: 1000 }),
			],
			["an invalid variant", () => ({ variantId: "x", quantity: 1 })],
		])("answers 400 to %s", async (_case, body) => {
			const { variantId } = await sellableVariant(panel);
			const token = await newCart();

			const response = await cart("POST", "/store/cart/lines", {
				token,
				payload: body(variantId),
			});

			expect(response.statusCode).toBe(400);
		});

		it.each(["draft", "archived"])(
			"answers 400 to a variant of a %s product",
			async (status) => {
				const { variantId } = await sellableVariant(panel, { status });
				const token = await newCart();

				expect((await add(token, variantId)).statusCode).toBe(400);
			},
		);

		it("answers 400 to another store's variant", async () => {
			const otherOwner = await fixtures.user();
			await fixtures.member(otherStore, otherOwner, "owner");
			const otherPanel = panelClient(app, await signIn(app, otherOwner));
			const { variantId } = await sellableVariant(otherPanel);
			const token = await newCart();

			expect((await add(token, variantId)).statusCode).toBe(400);
			await app.get(SessionService).destroyAllForUser(otherOwner.id);
		});

		it("answers 409 past the units in stock, unless the variant sells without them", async () => {
			const limited = await sellableVariant(panel, { stock: 3 });
			const untracked = await sellableVariant(panel, { stock: 0 });
			const backorder = await sellableVariant(panel, { stock: 0 });
			await panel.patch(`/admin/variants/${untracked.variantId}/stock`, {
				trackStock: false,
			});
			await panel.patch(`/admin/variants/${backorder.variantId}/stock`, {
				allowBackorder: true,
			});
			const token = await newCart();

			expect((await add(token, limited.variantId, 3)).statusCode).toBe(
				201,
			);
			expect((await add(token, limited.variantId, 1)).statusCode).toBe(
				409,
			);
			expect((await add(token, untracked.variantId, 5)).statusCode).toBe(
				201,
			);
			expect((await add(token, backorder.variantId, 5)).statusCode).toBe(
				201,
			);
		});

		it("takes the catalog's current price on every change", async () => {
			const shirt = await sellableVariant(panel, { price: 4990 });
			const cap = await sellableVariant(panel, { price: 1500 });
			const token = await newCart();
			await add(token, shirt.variantId);
			await panel.patch(`/admin/variants/${shirt.variantId}`, {
				price: 3990,
			});

			const response = await add(token, cap.variantId);

			expect(response.json<Cart>()).toMatchObject({
				lines: [{ unitPrice: 3990 }, { unitPrice: 1500 }],
				total: 5490,
			});
		});

		it("drops lines the store no longer sells on the next change", async () => {
			const archived = await sellableVariant(panel);
			const cap = await sellableVariant(panel);
			const token = await newCart();
			await add(token, archived.variantId);
			await panel.patch(`/admin/products/${archived.productId}`, {
				status: "archived",
			});

			const response = await add(token, cap.variantId);

			expect(response.json<Cart>().lines).toMatchObject([
				{ variantId: cap.variantId },
			]);
		});
	});

	describe("PATCH and DELETE /store/cart/lines/:id", () => {
		it("changes a line's quantity and removes it", async () => {
			const { variantId } = await sellableVariant(panel, { price: 1000 });
			const token = await newCart();
			const [line] = (await add(token, variantId)).json<Cart>().lines;

			const changed = await cart(
				"PATCH",
				`/store/cart/lines/${line.id}`,
				{
					token,
					payload: { quantity: 4 },
				},
			);
			expect(changed.statusCode).toBe(200);
			expect(changed.json<Cart>()).toMatchObject({
				lines: [{ id: line.id, quantity: 4, total: 4000 }],
				total: 4000,
			});
			expect(
				(
					await cart("PATCH", `/store/cart/lines/${line.id}`, {
						token,
						payload: { quantity: 11 },
					})
				).statusCode,
			).toBe(409);

			const removed = await cart(
				"DELETE",
				`/store/cart/lines/${line.id}`,
				{
					token,
				},
			);
			expect(removed.statusCode).toBe(200);
			expect(removed.json<Cart>()).toMatchObject({ lines: [], total: 0 });
		});

		it("answers 404 to a line of another cart", async () => {
			const { variantId } = await sellableVariant(panel);
			const [line] = (await add(await newCart(), variantId)).json<Cart>()
				.lines;
			const token = await newCart();

			for (const method of ["PATCH", "DELETE"] as const) {
				const response = await cart(
					method,
					`/store/cart/lines/${line.id}`,
					{ token, payload: { quantity: 2 } },
				);
				expect(response.statusCode).toBe(404);
			}
		});
	});

	describe("PUT /store/cart/customer", () => {
		const guest = (email: string, name = "Ana Souza") => ({
			email,
			name,
			phone: "(11) 98765-4321",
			taxId: "529.982.247-25",
		});
		const setCustomer = (
			token: string,
			payload?: unknown,
			headers?: Record<string, string>,
		) => cart("PUT", "/store/cart/customer", { token, payload, headers });
		const customerByEmail = async (email: string) =>
			(
				await panel.get(
					`/admin/customers?q=${encodeURIComponent(email)}`,
				)
			).json<{
				items: { id: string; name: string; registered: boolean }[];
			}>().items;
		const register = async (email: string) => {
			const response = await app.inject({
				method: "POST",
				url: "/store/account/register",
				headers: { "x-tenant": store.slug },
				payload: { email, password: "correct horse", name: "Bia" },
			});
			expect(response.statusCode).toBe(201);
			return response.json<{ token: string }>().token;
		};

		it("adds a guest customer for a new e-mail", async () => {
			const email = `${crypto.randomUUID()}@example.com`;
			const token = await newCart();

			const response = await setCustomer(
				token,
				guest(email.toUpperCase()),
			);

			expect(response.statusCode).toBe(200);
			expect(response.json<{ customer: unknown }>().customer).toEqual({
				email,
			});
			expect(await customerByEmail(email)).toMatchObject([
				{ name: "Ana Souza", registered: false },
			]);
		});

		it("links the guest the store already has, without changing them or showing them", async () => {
			const email = `${crypto.randomUUID()}@example.com`;
			await setCustomer(await newCart(), guest(email, "Ana Souza"));
			const token = await newCart();

			const response = await setCustomer(token, guest(email, "Someone"));

			expect(response.json()).toMatchObject({ customer: { email } });
			expect(JSON.stringify(response.json())).not.toContain("Ana");
			expect(await customerByEmail(email)).toMatchObject([
				{ name: "Ana Souza" },
			]);
		});

		it("answers 409 to the e-mail of a registered buyer", async () => {
			const email = `${crypto.randomUUID()}@example.com`;
			await register(email);

			const response = await setCustomer(await newCart(), guest(email));

			expect(response.statusCode).toBe(409);
		});

		it("links the signed-in buyer", async () => {
			const email = `${crypto.randomUUID()}@example.com`;
			const buyer = await register(email);
			const token = await newCart();

			const response = await setCustomer(token, undefined, {
				authorization: `Bearer ${buyer}`,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({ customer: { email } });
		});

		it("answers 401 to a buyer token that is not valid", async () => {
			const response = await setCustomer(await newCart(), undefined, {
				authorization: `Bearer ${"x".repeat(43)}`,
			});

			expect(response.statusCode).toBe(401);
		});

		it.each([
			["no e-mail", { name: "Ana" }],
			["an invalid e-mail", { email: "ana", name: "Ana" }],
			["no name", { email: "ana@example.com" }],
			[
				"an invalid phone",
				{ email: "ana@example.com", name: "Ana", phone: "1" },
			],
		])("answers 400 to %s", async (_case, payload) => {
			expect(
				(await setCustomer(await newCart(), payload)).statusCode,
			).toBe(400);
		});
	});

	describe("PUT /store/cart/shipping-address and billing-address", () => {
		const address = {
			recipient: "Ana Souza",
			phone: null,
			cep: "01310-100",
			street: "Av. Paulista",
			number: "1000",
			complement: "Apto 12",
			neighborhood: "Bela Vista",
			city: "São Paulo",
			state: "sp",
		};

		it.each([
			["shipping-address", "shippingAddress"],
			["billing-address", "billingAddress"],
		])("keeps a copy of the %s", async (path, field) => {
			const token = await newCart();

			const response = await cart("PUT", `/store/cart/${path}`, {
				token,
				payload: address,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				[field]: { ...address, cep: "01310100", state: "SP" },
			});
		});

		it.each([
			["an invalid CEP", { ...address, cep: "123" }],
			["no street", { ...address, street: undefined }],
			["a default flag", { ...address, defaultShipping: true }],
		])("answers 400 to %s", async (_case, payload) => {
			const response = await cart("PUT", "/store/cart/shipping-address", {
				token: await newCart(),
				payload,
			});
			expect(response.statusCode).toBe(400);
		});
	});
});
