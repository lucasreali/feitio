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

interface Address {
	id: string;
	defaultShipping: boolean;
	defaultBilling: boolean;
}

interface Customer {
	id: string;
	email: string;
	addresses: Address[];
}

const address = {
	recipient: "Ana Souza",
	cep: "01310-100",
	street: "Av. Paulista",
	number: "1000",
	neighborhood: "Bela Vista",
	city: "São Paulo",
	state: "SP",
};

// Runs against the real PostgreSQL and Valkey in .env.test.
describe("Customers panel routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	const newCustomer = async (
		fields: Record<string, unknown> = {},
		client: PanelClient = panel,
	) => {
		const response = await client.post("/admin/customers", {
			email: `${crypto.randomUUID()}@example.com`,
			name: "Ana Souza",
			...fields,
		});
		expect(response.statusCode).toBe(201);
		return response.json<Customer>();
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

	describe("POST /admin/customers", () => {
		it("creates a guest customer", async () => {
			const response = await panel.post("/admin/customers", {
				email: " Bia@Example.com ",
				name: "Bia",
				phone: "(11) 98765-4321",
				taxId: "529.982.247-25",
			});

			expect(response.statusCode).toBe(201);
			expect(response.json()).toEqual({
				id: expect.any(String),
				email: "bia@example.com",
				name: "Bia",
				phone: "+5511987654321",
				taxId: "52998224725",
				registered: false,
				createdAt: expect.any(String),
				addresses: [],
				groups: [],
			});
		});

		it("answers 409 to an e-mail already in the store, but not in another store", async () => {
			const { email } = await newCustomer();

			expect(
				(
					await panel.post("/admin/customers", {
						email: email.toUpperCase(),
						name: "Other",
					})
				).statusCode,
			).toBe(409);
			await newCustomer({ email }, otherPanel);
		});

		it("answers 400 to an invalid customer", async () => {
			expect(
				(
					await panel.post("/admin/customers", {
						email: "x",
						name: "Ana",
					})
				).statusCode,
			).toBe(400);
		});
	});

	describe("GET /admin/customers", () => {
		it("lists the store's customers, newest first, searching name and e-mail", async () => {
			const tag = crypto.randomUUID().slice(0, 8);
			const first = await newCustomer({ name: `Carla ${tag}` });
			const second = await newCustomer({
				email: `${tag}@example.com`,
				name: "Davi",
			});
			await newCustomer({ name: `Carla ${tag}` }, otherPanel);

			const response = await panel.get(`/admin/customers?q=${tag}`);

			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				items: [
					{
						id: second.id,
						email: `${tag}@example.com`,
						name: "Davi",
						phone: null,
						registered: false,
						createdAt: expect.any(String),
					},
					expect.objectContaining({ id: first.id }),
				],
				page: 1,
				pageSize: 24,
				total: 2,
			});
		});

		it("treats % and _ in the search as text", async () => {
			await newCustomer({ name: "Eva" });
			expect(
				(await panel.get("/admin/customers?q=%25")).json(),
			).toMatchObject({ total: 0 });
		});
	});

	describe("GET and PATCH /admin/customers/:id", () => {
		it("changes the customer's fields, and clears phone with null", async () => {
			const { id } = await newCustomer({ phone: "11987654321" });

			const response = await panel.patch(`/admin/customers/${id}`, {
				name: "Ana Lima",
				phone: null,
			});

			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				name: "Ana Lima",
				phone: null,
			});
			expect(
				(await panel.get(`/admin/customers/${id}`)).json(),
			).toMatchObject({ name: "Ana Lima" });
		});

		it("answers 409 to an e-mail already in the store", async () => {
			const { email } = await newCustomer();
			const { id } = await newCustomer();
			expect(
				(await panel.patch(`/admin/customers/${id}`, { email }))
					.statusCode,
			).toBe(409);
		});

		it("answers 404 to another store's customer", async () => {
			const { id } = await newCustomer({}, otherPanel);
			expect((await panel.get(`/admin/customers/${id}`)).statusCode).toBe(
				404,
			);
			expect(
				(await panel.patch(`/admin/customers/${id}`, { name: "x" }))
					.statusCode,
			).toBe(404);
			expect(
				(await panel.get("/admin/customers/not-an-id")).statusCode,
			).toBe(404);
		});
	});

	describe("addresses", () => {
		it("adds addresses, keeping one default for shipping and one for billing", async () => {
			const { id } = await newCustomer();

			const first = await panel.post(`/admin/customers/${id}/addresses`, {
				...address,
				defaultShipping: true,
				defaultBilling: true,
			});
			expect(first.statusCode).toBe(201);
			expect(first.json<Customer>().addresses).toEqual([
				{
					id: expect.any(String),
					recipient: "Ana Souza",
					phone: null,
					cep: "01310100",
					street: "Av. Paulista",
					number: "1000",
					complement: null,
					neighborhood: "Bela Vista",
					city: "São Paulo",
					state: "SP",
					defaultShipping: true,
					defaultBilling: true,
				},
			]);
			const second = await panel.post(
				`/admin/customers/${id}/addresses`,
				{
					...address,
					number: "2000",
					defaultShipping: true,
				},
			);

			const addresses = second.json<Customer>().addresses;
			expect(
				addresses.map((a) => [a.defaultShipping, a.defaultBilling]),
			).toEqual([
				[true, false],
				[false, true],
			]);
		});

		it("changes and removes an address", async () => {
			const { id } = await newCustomer();
			const [added] = (
				await panel.post(`/admin/customers/${id}/addresses`, address)
			).json<Customer>().addresses;

			const changed = await panel.patch(
				`/admin/customers/${id}/addresses/${added.id}`,
				{ complement: "ap. 12", defaultBilling: true },
			);
			expect(changed.statusCode).toBe(200);
			expect(changed.json<Customer>().addresses).toEqual([
				expect.objectContaining({
					complement: "ap. 12",
					defaultBilling: true,
				}),
			]);

			const removed = await panel.delete(
				`/admin/customers/${id}/addresses/${added.id}`,
			);
			expect(removed.statusCode).toBe(200);
			expect(removed.json<Customer>().addresses).toEqual([]);
		});

		it("answers 404 to an address of another customer", async () => {
			const owner = await newCustomer();
			const [added] = (
				await panel.post(
					`/admin/customers/${owner.id}/addresses`,
					address,
				)
			).json<Customer>().addresses;
			const { id } = await newCustomer();

			expect(
				(
					await panel.patch(
						`/admin/customers/${id}/addresses/${added.id}`,
						{
							number: "1",
						},
					)
				).statusCode,
			).toBe(404);
			expect(
				(
					await panel.delete(
						`/admin/customers/${id}/addresses/${added.id}`,
					)
				).statusCode,
			).toBe(404);
		});

		it("answers 400 to an invalid address", async () => {
			const { id } = await newCustomer();
			expect(
				(
					await panel.post(`/admin/customers/${id}/addresses`, {
						...address,
						cep: "123",
					})
				).statusCode,
			).toBe(400);
		});
	});
});
