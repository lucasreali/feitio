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

interface HistoryEntry {
	id: string;
	kind: string;
	data: Record<string, unknown>;
	user: { id: string; name: string } | null;
	createdAt: string;
}

interface HistoryPage {
	items: HistoryEntry[];
	total: number;
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

// Runs against the real PostgreSQL and Valkey in .env.
describe("Customer history (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	const history = async (id: string, client: PanelClient = panel) => {
		const response = await client.get(
			`/admin/customers/${id}/history?pageSize=100`,
		);
		expect(response.statusCode).toBe(200);
		return response.json<HistoryPage>();
	};
	/** Kind and data of each entry, oldest first. */
	const kinds = async (id: string) =>
		(await history(id)).items
			.map(({ kind, data }) => ({ kind, data }))
			.reverse();
	const store_ = (
		method: "POST" | "PATCH",
		url: string,
		payload: unknown,
		token?: string,
	) =>
		app.inject({
			method,
			url,
			payload: payload as object,
			headers: {
				"x-tenant": store.slug,
				...(token && { authorization: `Bearer ${token}` }),
			},
		});

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

	it("records what the panel does, and who did it", async () => {
		const group = (
			await panel.post("/admin/customer-groups", {
				name: `VIP ${crypto.randomUUID().slice(0, 8)}`,
			})
		).json<{ id: string; name: string }>();
		const { id } = (
			await panel.post("/admin/customers", {
				email: `${crypto.randomUUID()}@example.com`,
				name: "Ana",
			})
		).json<{ id: string }>();
		await panel.patch(`/admin/customers/${id}`, {
			name: "Ana Souza",
			phone: "11987654321",
			groupIds: [group.id],
		});
		const added = await panel.post(
			`/admin/customers/${id}/addresses`,
			address,
		);
		const [{ id: addressId }] = added.json<{
			addresses: { id: string }[];
		}>().addresses;
		await panel.patch(`/admin/customers/${id}/addresses/${addressId}`, {
			number: "1001",
		});
		await panel.delete(`/admin/customers/${id}/addresses/${addressId}`);
		await panel.patch(`/admin/customers/${id}`, { groupIds: [] });

		expect(await kinds(id)).toEqual([
			{ kind: "created", data: {} },
			{ kind: "profile_updated", data: { fields: ["name", "phone"] } },
			{
				kind: "added_to_group",
				data: { groupId: group.id, groupName: group.name },
			},
			{ kind: "address_added", data: { addressId } },
			{
				kind: "address_updated",
				data: { addressId, fields: ["number"] },
			},
			{ kind: "address_removed", data: { addressId } },
			{
				kind: "removed_from_group",
				data: { groupId: group.id, groupName: group.name },
			},
		]);
		const [latest] = (await history(id)).items;
		expect(latest).toEqual({
			id: expect.any(String),
			kind: "removed_from_group",
			data: expect.any(Object),
			user: { id: staff.id, name: staff.name },
			createdAt: expect.any(String),
		});
	});

	it("records what the buyer does, without a panel user", async () => {
		const email = `${crypto.randomUUID()}@example.com`;
		const registered = await store_("POST", "/store/account/register", {
			email,
			password: "correct horse",
			name: "Bia",
		});
		const { token, customer } = registered.json<{
			token: string;
			customer: { id: string };
		}>();
		await store_(
			"PATCH",
			"/store/account",
			{ taxId: "52998224725" },
			token,
		);
		await store_(
			"POST",
			"/store/account/password",
			{ currentPassword: "correct horse", newPassword: "new password" },
			token,
		);

		const { items } = await history(customer.id);
		expect(
			items
				.map(({ kind, data, user }) => ({ kind, data, user }))
				.reverse(),
		).toEqual([
			{ kind: "registered", data: {}, user: null },
			{
				kind: "profile_updated",
				data: { fields: ["taxId"] },
				user: null,
			},
			{ kind: "password_changed", data: {}, user: null },
		]);
	});

	it("adds notes from the panel", async () => {
		const { id } = (
			await panel.post("/admin/customers", {
				email: `${crypto.randomUUID()}@example.com`,
				name: "Caio",
			})
		).json<{ id: string }>();

		const response = await panel.post(`/admin/customers/${id}/notes`, {
			note: " Prefers delivery after 6pm ",
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toEqual({
			id: expect.any(String),
			kind: "note",
			data: { note: "Prefers delivery after 6pm" },
			user: { id: staff.id, name: staff.name },
			createdAt: expect.any(String),
		});
		expect((await history(id)).total).toBe(2);
		expect(
			(await panel.post(`/admin/customers/${id}/notes`, { note: " " }))
				.statusCode,
		).toBe(400);
	});

	it("answers 404 to another store's customer", async () => {
		const { id } = (
			await otherPanel.post("/admin/customers", {
				email: `${crypto.randomUUID()}@example.com`,
				name: "Davi",
			})
		).json<{ id: string }>();

		expect(
			(await panel.get(`/admin/customers/${id}/history`)).statusCode,
		).toBe(404);
		expect(
			(await panel.post(`/admin/customers/${id}/notes`, { note: "x" }))
				.statusCode,
		).toBe(404);
	});
});
