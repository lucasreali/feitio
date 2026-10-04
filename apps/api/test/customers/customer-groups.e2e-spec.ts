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

interface Group {
	id: string;
	name: string;
	customerCount: number;
}

// Runs against the real PostgreSQL and Valkey in .env.
describe("Customer groups panel routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let staff: TestUser;
	let otherOwner: TestUser;
	let panel: PanelClient;
	let otherPanel: PanelClient;

	const newGroup = async (client: PanelClient = panel) => {
		const response = await client.post("/admin/customer-groups", {
			name: `Group ${crypto.randomUUID().slice(0, 8)}`,
		});
		expect(response.statusCode).toBe(201);
		return response.json<Group>();
	};
	const newCustomer = async (groupIds: string[] = []) => {
		const response = await panel.post("/admin/customers", {
			email: `${crypto.randomUUID()}@example.com`,
			name: "Ana",
			groupIds,
		});
		expect(response.statusCode).toBe(201);
		return response.json<{ id: string; groups: Group[] }>();
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

	it("creates, renames, lists and removes groups", async () => {
		const created = await panel.post("/admin/customer-groups", {
			name: " Atacado ",
		});
		expect(created.json()).toEqual({
			id: expect.any(String),
			name: "Atacado",
			customerCount: 0,
		});
		const { id } = created.json<Group>();

		const renamed = await panel.patch(`/admin/customer-groups/${id}`, {
			name: "Atacado SP",
		});
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json()).toMatchObject({ id, name: "Atacado SP" });
		await newGroup(otherPanel);
		expect(
			(await panel.get("/admin/customer-groups")).json<Group[]>(),
		).toEqual([{ id, name: "Atacado SP", customerCount: 0 }]);

		expect(
			(await panel.delete(`/admin/customer-groups/${id}`)).statusCode,
		).toBe(204);
		expect((await panel.get("/admin/customer-groups")).json()).toEqual([]);
	});

	it("answers 409 to a name already in use", async () => {
		const { name } = await newGroup();
		expect(
			(await panel.post("/admin/customer-groups", { name })).statusCode,
		).toBe(409);
	});

	it("answers 404 to another store's group", async () => {
		const { id } = await newGroup(otherPanel);
		expect(
			(await panel.patch(`/admin/customer-groups/${id}`, { name: "x" }))
				.statusCode,
		).toBe(404);
		expect(
			(await panel.delete(`/admin/customer-groups/${id}`)).statusCode,
		).toBe(404);
	});

	it("puts customers in groups and filters customers by group", async () => {
		const [vip, wholesale] = [await newGroup(), await newGroup()];
		const customer = await newCustomer([vip.id]);
		expect(customer.groups).toEqual([{ id: vip.id, name: vip.name }]);
		await newCustomer();

		const changed = await panel.patch(`/admin/customers/${customer.id}`, {
			groupIds: [wholesale.id, vip.id],
		});
		expect(changed.statusCode).toBe(200);
		expect(changed.json<{ groups: Group[] }>().groups).toHaveLength(2);

		const inVip = await panel.get(`/admin/customers?groupId=${vip.id}`);
		expect(inVip.json()).toMatchObject({
			items: [{ id: customer.id }],
			total: 1,
		});
		expect(
			(await panel.get("/admin/customer-groups"))
				.json<Group[]>()
				.find((group) => group.id === vip.id),
		).toMatchObject({ customerCount: 1 });

		await panel.delete(`/admin/customer-groups/${vip.id}`);
		expect(
			(await panel.get(`/admin/customers/${customer.id}`)).json(),
		).toMatchObject({ groups: [{ id: wholesale.id }] });
	});

	it("answers 400 to a group of another store", async () => {
		const { id } = await newGroup(otherPanel);
		const response = await panel.post("/admin/customers", {
			email: `${crypto.randomUUID()}@example.com`,
			name: "Ana",
			groupIds: [id],
		});
		expect(response.statusCode).toBe(400);
		expect(
			(await panel.get(`/admin/customers?groupId=${id}`)).json(),
		).toMatchObject({ total: 0 });
		expect(
			(await panel.get("/admin/customers?groupId=vip")).statusCode,
		).toBe(400);
	});
});
