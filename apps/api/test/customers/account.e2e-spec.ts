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

interface Account {
	id: string;
	email: string;
	addresses: { id: string }[];
}

interface SignedIn {
	token: string;
	customer: Account;
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
describe("Store account routes (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;
	let otherStore: TestTenant;
	let owner: TestUser;
	let panel: PanelClient;

	/** A request to a store route, with the buyer's token when given. */
	const call = (
		method: "GET" | "POST" | "PATCH" | "DELETE",
		url: string,
		options: {
			token?: string;
			payload?: unknown;
			tenant?: TestTenant;
		} = {},
	) =>
		app.inject({
			method,
			url,
			payload: options.payload as object | undefined,
			headers: {
				"x-tenant": (options.tenant ?? store).slug,
				...(options.token && {
					authorization: `Bearer ${options.token}`,
				}),
			},
		});

	const register = async ({
		tenant = store,
		...fields
	}: {
		tenant?: TestTenant;
		email?: string;
	} = {}) => {
		const password = "correct horse";
		const response = await call("POST", "/store/account/register", {
			payload: {
				email: `${crypto.randomUUID()}@example.com`,
				password,
				name: "Ana Souza",
				...fields,
			},
			tenant,
		});
		expect(response.statusCode).toBe(201);
		return { ...response.json<SignedIn>(), password };
	};
	const login = (email: string, password: string, tenant = store) =>
		call("POST", "/store/account/login", {
			payload: { email, password },
			tenant,
		});

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
		otherStore = await fixtures.tenant();
		owner = await fixtures.user();
		await fixtures.member(store, owner, "owner");
		panel = panelClient(app, await signIn(app, owner));
	});

	afterAll(async () => {
		await app.get(SessionService).destroyAllForUser(owner.id);
		await fixtures.close();
		await app.close();
	});

	describe("POST /store/account/register", () => {
		it("creates a registered customer and signs them in", async () => {
			const response = await call("POST", "/store/account/register", {
				payload: {
					email: " Bia@Example.com ",
					password: "correct horse",
					name: "Bia",
					taxId: "529.982.247-25",
				},
			});

			expect(response.statusCode).toBe(201);
			const { token, customer } = response.json<SignedIn>();
			expect(token).toMatch(/^[\w-]{43}$/);
			expect(customer).toEqual({
				id: expect.any(String),
				email: "bia@example.com",
				name: "Bia",
				phone: null,
				taxId: "52998224725",
				addresses: [],
			});
			expect(
				(await call("GET", "/store/account", { token })).json(),
			).toEqual(customer);
			expect(
				(await panel.get(`/admin/customers/${customer.id}`)).json(),
			).toMatchObject({ registered: true });
		});

		it("answers 409 to an e-mail the store already has, guest or registered", async () => {
			const { customer } = await register();
			const guest = await panel.post("/admin/customers", {
				email: `${crypto.randomUUID()}@example.com`,
				name: "Guest",
			});

			for (const email of [customer.email, guest.json<Account>().email]) {
				const response = await call("POST", "/store/account/register", {
					payload: { email, password: "correct horse", name: "Ana" },
				});
				expect(response.statusCode).toBe(409);
			}
			await register({ email: customer.email, tenant: otherStore });
		});

		it("answers 400 to a short password", async () => {
			const response = await call("POST", "/store/account/register", {
				payload: {
					email: `${crypto.randomUUID()}@example.com`,
					password: "short",
					name: "Ana",
				},
			});
			expect(response.statusCode).toBe(400);
		});
	});

	describe("POST /store/account/login", () => {
		it("signs in with the right password only", async () => {
			const { customer, password } = await register();

			const response = await login(customer.email, password);
			expect(response.statusCode).toBe(200);
			const { token } = response.json<SignedIn>();
			expect(
				(await call("GET", "/store/account", { token })).statusCode,
			).toBe(200);
			expect(
				(await login(customer.email, "wrong password")).statusCode,
			).toBe(401);
			expect(
				(await login(`${crypto.randomUUID()}@example.com`, password))
					.statusCode,
			).toBe(401);
			expect(
				(await login(customer.email, password, otherStore)).statusCode,
			).toBe(401);
		});

		it("does not sign a guest in", async () => {
			const guest = await panel.post("/admin/customers", {
				email: `${crypto.randomUUID()}@example.com`,
				name: "Guest",
			});
			expect(
				(await login(guest.json<Account>().email, "")).statusCode,
			).toBe(401);
		});

		it("refuses sign-in after 5 failed attempts", async () => {
			const { customer, password } = await register();
			for (let attempt = 0; attempt < 5; attempt++) {
				expect((await login(customer.email, "wrong")).statusCode).toBe(
					401,
				);
			}

			const response = await login(customer.email, password);
			expect(response.statusCode).toBe(429);
			expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
		});
	});

	describe("tokens", () => {
		it("answers 401 without a valid token, or with another store's token", async () => {
			const { token } = await register({ tenant: otherStore });
			for (const authorization of [
				undefined,
				"Bearer nope",
				`Basic ${token}`,
			]) {
				const response = await app.inject({
					method: "GET",
					url: "/store/account",
					headers: {
						"x-tenant": store.slug,
						...(authorization && { authorization }),
					},
				});
				expect(response.statusCode).toBe(401);
			}
			expect(
				(await call("GET", "/store/account", { token })).statusCode,
			).toBe(401);
			expect(
				(await call("POST", "/store/account/logout", { token }))
					.statusCode,
			).toBe(401);
			expect(
				(
					await call("GET", "/store/account", {
						token,
						tenant: otherStore,
					})
				).statusCode,
			).toBe(200);
		});

		it("ends the session on logout", async () => {
			const { token } = await register();

			expect(
				(await call("POST", "/store/account/logout", { token }))
					.statusCode,
			).toBe(204);
			expect(
				(await call("GET", "/store/account", { token })).statusCode,
			).toBe(401);
		});
	});

	describe("PATCH /store/account", () => {
		it("changes the profile, but not the e-mail", async () => {
			const { token } = await register();

			const response = await call("PATCH", "/store/account", {
				token,
				payload: { name: "Ana Lima", phone: "(11) 98765-4321" },
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toMatchObject({
				name: "Ana Lima",
				phone: "+5511987654321",
			});
			expect(
				(
					await call("PATCH", "/store/account", {
						token,
						payload: { email: "other@example.com" },
					})
				).statusCode,
			).toBe(400);
		});
	});

	describe("POST /store/account/password", () => {
		it("changes the password and ends every other session", async () => {
			const { customer, token, password } = await register();
			const other = (
				await login(customer.email, password)
			).json<SignedIn>();

			expect(
				(
					await call("POST", "/store/account/password", {
						token,
						payload: {
							currentPassword: "wrong password",
							newPassword: "new password",
						},
					})
				).statusCode,
			).toBe(403);
			const response = await call("POST", "/store/account/password", {
				token,
				payload: {
					currentPassword: password,
					newPassword: "new password",
				},
			});

			expect(response.statusCode).toBe(200);
			const renewed = response.json<{ token: string }>().token;
			for (const old of [token, other.token]) {
				expect(
					(await call("GET", "/store/account", { token: old }))
						.statusCode,
				).toBe(401);
			}
			expect(
				(await call("GET", "/store/account", { token: renewed }))
					.statusCode,
			).toBe(200);
			expect((await login(customer.email, password)).statusCode).toBe(
				401,
			);
			expect(
				(await login(customer.email, "new password")).statusCode,
			).toBe(200);
		});
	});

	describe("addresses", () => {
		it("adds, changes and removes the buyer's own addresses", async () => {
			const { token } = await register();

			const added = await call("POST", "/store/account/addresses", {
				token,
				payload: { ...address, defaultShipping: true },
			});
			expect(added.statusCode).toBe(201);
			const [{ id }] = added.json<Account>().addresses;
			const changed = await call(
				"PATCH",
				`/store/account/addresses/${id}`,
				{
					token,
					payload: { number: "1001" },
				},
			);
			expect(changed.statusCode).toBe(200);
			expect(changed.json()).toMatchObject({
				addresses: [{ id, number: "1001", defaultShipping: true }],
			});
			const removed = await call(
				"DELETE",
				`/store/account/addresses/${id}`,
				{
					token,
				},
			);
			expect(removed.statusCode).toBe(200);
			expect(removed.json()).toMatchObject({ addresses: [] });
		});

		it("answers 404 to another buyer's address", async () => {
			const first = await register();
			const [{ id }] = (
				await call("POST", "/store/account/addresses", {
					token: first.token,
					payload: address,
				})
			).json<Account>().addresses;
			const { token } = await register();

			expect(
				(
					await call("PATCH", `/store/account/addresses/${id}`, {
						token,
						payload: { number: "1" },
					})
				).statusCode,
			).toBe(404);
			expect(
				(
					await call("DELETE", `/store/account/addresses/${id}`, {
						token,
					})
				).statusCode,
			).toBe(404);
		});
	});
});
