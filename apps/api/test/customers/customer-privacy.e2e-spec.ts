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

const address = {
	recipient: "Ana Souza",
	cep: "01310-100",
	street: "Av. Paulista",
	number: "1000",
	neighborhood: "Bela Vista",
	city: "São Paulo",
	state: "SP",
};

// Runs against the real PostgreSQL and Valkey in .env.
describe("Customer data requests, LGPD (e2e)", () => {
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

	const storeCall = (
		method: "GET" | "POST",
		url: string,
		options: { token?: string; payload?: unknown } = {},
	) =>
		app.inject({
			method,
			url,
			payload: options.payload as object | undefined,
			headers: {
				"x-tenant": store.slug,
				...(options.token && {
					authorization: `Bearer ${options.token}`,
				}),
			},
		});
	/** A registered buyer with an address, in a group, with a note. */
	const buyer = async () => {
		const email = `${crypto.randomUUID()}@example.com`;
		const { token, customer } = (
			await storeCall("POST", "/store/account/register", {
				payload: { email, password: "correct horse", name: "Ana" },
			})
		).json<{ token: string; customer: { id: string } }>();
		await storeCall("POST", "/store/account/addresses", {
			token,
			payload: address,
		});
		const group = (
			await panel.post("/admin/customer-groups", {
				name: `VIP ${crypto.randomUUID().slice(0, 8)}`,
			})
		).json<{ id: string; name: string }>();
		await panel.patch(`/admin/customers/${customer.id}`, {
			groupIds: [group.id],
		});
		await panel.post(`/admin/customers/${customer.id}/notes`, {
			note: "Asked for her data",
		});
		return { id: customer.id, email, token, group };
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

	describe("GET /admin/customers/:id/export", () => {
		it("hands over everything the store keeps about the customer", async () => {
			const { id, email, group } = await buyer();

			const response = await staffPanel.get(
				`/admin/customers/${id}/export`,
			);

			expect(response.statusCode).toBe(200);
			expect(response.headers["content-disposition"]).toBe(
				`attachment; filename="customer-${id}.json"`,
			);
			const data = response.json();
			expect(data).toEqual({
				exportedAt: expect.any(String),
				customer: {
					id,
					email,
					name: "Ana",
					phone: null,
					taxId: null,
					registered: true,
					createdAt: expect.any(String),
					updatedAt: expect.any(String),
				},
				addresses: [expect.objectContaining({ cep: "01310100" })],
				groups: [{ id: group.id, name: group.name }],
				history: expect.any(Array),
			});
			expect(
				data.history.map((entry: { kind: string }) => entry.kind),
			).toEqual([
				"note",
				"added_to_group",
				"address_added",
				"registered",
			]);
			expect(JSON.stringify(data)).not.toContain("scrypt");
		});

		it("answers 404 to another store's customer", async () => {
			const { id } = await buyer();
			expect(
				(await otherPanel.get(`/admin/customers/${id}/export`))
					.statusCode,
			).toBe(404);
		});
	});

	describe("DELETE /admin/customers/:id", () => {
		it("erases the customer and ends their sessions", async () => {
			const { id, email, token } = await buyer();

			expect(
				(await panel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(204);

			expect((await panel.get(`/admin/customers/${id}`)).statusCode).toBe(
				404,
			);
			expect(
				(await panel.get(`/admin/customers/${id}/history`)).statusCode,
			).toBe(404);
			expect(
				(await storeCall("GET", "/store/account", { token }))
					.statusCode,
			).toBe(401);
			const again = await storeCall("POST", "/store/account/register", {
				payload: { email, password: "correct horse", name: "Ana" },
			});
			expect(again.statusCode).toBe(201);
		});

		it("is only for the store's owner", async () => {
			const { id } = await buyer();
			expect(
				(await staffPanel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(403);
			expect((await panel.get(`/admin/customers/${id}`)).statusCode).toBe(
				200,
			);
		});

		it("answers 404 to another store's customer", async () => {
			const { id } = await buyer();
			expect(
				(await otherPanel.delete(`/admin/customers/${id}`)).statusCode,
			).toBe(404);
		});
	});
});
