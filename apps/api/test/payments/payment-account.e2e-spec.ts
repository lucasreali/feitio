import { createHash } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { paymentAccounts } from "../../src/database/schemas/payment-accounts.js";
import { ASAAS_API } from "../../src/payments/adapters/asaas.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../../src/tenancy/tenant-database.js";
import {
	Fixtures,
	type PanelClient,
	panelClient,
	signIn,
	startApp,
	type TestTenant,
} from "../fixtures.js";
import { type FakeAsaas, fakeAsaas } from "./fake-asaas.js";

const company = {
	name: "Loja da Ana",
	email: "loja@example.com",
	taxId: "11.222.333/0001-81",
	companyType: "MEI",
	phone: "(11) 98888-7777",
	monthlyIncome: 2500000,
	address: {
		street: "Av. Paulista",
		number: "1000",
		neighborhood: "Bela Vista",
		cep: "01310-100",
	},
};

describe("Payment account (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let asaas: FakeAsaas;
	let tenant: TestTenant;
	let owner: PanelClient;
	let staff: PanelClient;

	const storedAccount = (store: TestTenant) =>
		TenantContext.run(store, () =>
			app
				.get(TenantDatabase)
				.run((tx) => tx.select().from(paymentAccounts)),
		);

	beforeAll(async () => {
		asaas = fakeAsaas();
		app = await startApp((b) =>
			b.overrideProvider(ASAAS_API).useValue(asaas.api),
		);
		fixtures = await Fixtures.open();
		tenant = await fixtures.tenant();
		const ownerUser = await fixtures.user();
		const staffUser = await fixtures.user();
		await fixtures.member(tenant, ownerUser, "owner");
		await fixtures.member(tenant, staffUser, "staff");
		owner = panelClient(app, await signIn(app, ownerUser));
		staff = panelClient(app, await signIn(app, staffUser));
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("has no account before the owner opens one", async () => {
		expect((await owner.get("/admin/payments/account")).statusCode).toBe(
			404,
		);
	});

	it("lets only owners open the account", async () => {
		const response = await staff.post("/admin/payments/account", company);
		expect(response.statusCode).toBe(403);
		expect(asaas.accounts).toEqual([]);
	});

	it("refuses an invalid account without calling the gateway", async () => {
		const response = await owner.post("/admin/payments/account", {
			...company,
			companyType: undefined,
		});
		expect(response.statusCode).toBe(400);
		expect(asaas.accounts).toEqual([]);
	});

	it("answers the gateway's refusal as 400, and keeps no account", async () => {
		asaas.control.refuse = "O CNPJ informado já está em uso.";
		const response = await owner.post("/admin/payments/account", company);
		expect(response.statusCode).toBe(400);
		expect(response.json().message).toBe(
			"O CNPJ informado já está em uso.",
		);
		expect(await storedAccount(tenant)).toEqual([]);
	});

	it("opens the store's subaccount, with its webhook, and keeps its key sealed", async () => {
		const response = await owner.post("/admin/payments/account", company);
		expect(response.statusCode).toBe(201);
		const account = response.json();
		expect(account).toEqual({
			walletId: expect.stringMatching(/^wallet_/),
			createdAt: expect.any(String),
		});

		const [created] = asaas.accounts;
		const [webhook] = created.body.webhooks as {
			url: string;
			authToken: string;
		}[];
		expect(webhook.url).toBe(
			`${process.env.PUBLIC_API_URL}/webhooks/asaas/${tenant.id}`,
		);
		expect(webhook.authToken).toMatch(/^[0-9a-f]{64}$/);

		const [stored] = await storedAccount(tenant);
		expect(stored).toMatchObject({
			walletId: account.walletId,
			webhookTokenHash: createHash("sha256")
				.update(webhook.authToken)
				.digest("hex"),
		});
		// Sealed: never the key Asaas answered.
		expect(stored.credential).not.toContain(created.apiKey);

		expect((await owner.get("/admin/payments/account")).json()).toEqual(
			account,
		);
		expect((await staff.get("/admin/payments/account")).json()).toEqual(
			account,
		);
	});

	it("opens one account per store", async () => {
		const response = await owner.post("/admin/payments/account", company);
		expect(response.statusCode).toBe(409);
		expect(asaas.accounts).toHaveLength(1);
	});
});
