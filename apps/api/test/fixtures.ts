import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { asc } from "drizzle-orm";
import pg from "pg";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/app.setup.js";
import { hashPassword } from "../src/auth/password.js";
import { domainEvents } from "../src/database/schemas/domain-events.js";
import type { MembershipRole } from "../src/database/schemas/memberships.js";
import { Cpf } from "../src/domain/cpf.js";
import { Email } from "../src/domain/email.js";
import { TenantId, UserId } from "../src/domain/ids.js";
import { TenantSlug } from "../src/domain/tenant-slug.js";
import {
	EVENT_HANDLERS,
	type EventHandler,
} from "../src/events/event-handler.js";
import { QUEUE_OPTIONS, queueConnection } from "../src/events/queue.js";
import { readSessionConfig } from "../src/session/session.config.js";
import { TenantContext } from "../src/tenancy/tenant-context.js";
import { TenantDatabase } from "../src/tenancy/tenant-database.js";
import { WorkerModule } from "../src/worker.module.js";

/** A random valid CPF: nine random digits plus their check digits. */
export function randomCpf(): Cpf {
	const digits = Array.from({ length: 9 }, () =>
		Math.floor(Math.random() * 10),
	);
	for (const length of [9, 10]) {
		const sum = digits.reduce(
			(total, digit, index) => total + digit * (length + 1 - index),
			0,
		);
		digits.push(((sum * 10) % 11) % 10);
	}
	// Nine equal random digits are refused; draw again (1 in 10^8).
	return Cpf.tryParse(digits.join("")) ?? randomCpf();
}

export interface TestTenant {
	id: TenantId;
	slug: TenantSlug;
	name: string;
}

export interface TestUser {
	id: UserId;
	email: Email;
	name: string;
	cpf: Cpf;
	password: string;
}

/**
 * Creates tenants, users and memberships in the real PostgreSQL of .env, the
 * way production data is written (tenants and users by the owner,
 * memberships by the application role in the tenant), and deletes them all
 * in close().
 */
export class Fixtures {
	private readonly tenants: TenantId[] = [];
	private readonly users: UserId[] = [];

	private constructor(
		private readonly owner: pg.Client,
		private readonly app: pg.Client,
	) {}

	static async open(): Promise<Fixtures> {
		const owner = new pg.Client({
			connectionString: process.env.MIGRATION_DATABASE_URL,
		});
		const app = new pg.Client({
			connectionString: process.env.DATABASE_URL,
		});
		await Promise.all([owner.connect(), app.connect()]);
		return new Fixtures(owner, app);
	}

	async tenant(
		status: "active" | "inactive" = "active",
	): Promise<TestTenant> {
		const id = TenantId.generate();
		const slug = TenantSlug.parse(`test-${id.slice(-12)}`);
		const name = `Store ${slug}`;
		await this.owner.query(
			"insert into tenants (id, name, slug, status) values ($1, $2, $3, $4)",
			[id, name, slug, status],
		);
		this.tenants.push(id);
		return { id, slug, name };
	}

	/** A user with a real password hash, so it can sign in. */
	async user(password = `pw-${crypto.randomUUID()}`): Promise<TestUser> {
		const id = UserId.generate();
		const email = Email.parse(`test-${id}@feitio.test`);
		const name = `User ${id.slice(-6)}`;
		const cpf = randomCpf();
		await this.owner.query(
			"insert into users (id, email, name, cpf, password_hash) values ($1, $2, $3, $4, $5)",
			[id, email, name, cpf, await hashPassword(password)],
		);
		this.users.push(id);
		return { id, email, name, cpf, password };
	}

	async member(tenant: TestTenant, user: TestUser, role: MembershipRole) {
		await this.app.query("begin");
		try {
			await this.app.query(
				"select set_config('app.tenant_id', $1, true)",
				[tenant.id],
			);
			await this.app.query(
				"insert into memberships (tenant_id, user_id, role) values ($1, $2, $3)",
				[tenant.id, user.id, role],
			);
			await this.app.query("commit");
		} catch (error) {
			await this.app.query("rollback");
			throw error;
		}
	}

	/** Runs a statement as the owner of the tables. */
	query(statement: string, params: unknown[] = []) {
		return this.owner.query(statement, params);
	}

	async close() {
		await this.owner.query("delete from tenants where id = any($1)", [
			this.tenants,
		]);
		await this.owner.query("delete from users where id = any($1)", [
			this.users,
		]);
		await Promise.all([this.owner.end(), this.app.end()]);
	}
}

/** Cookies and headers of a signed-in panel user, CSRF token included. */
export interface PanelAuth {
	cookies: Record<string, string>;
	headers: Record<string, string>;
}

/** Signs in through POST /auth/login and fetches a CSRF token. */
export async function signIn(
	app: NestFastifyApplication,
	user: TestUser,
): Promise<PanelAuth> {
	const { cookieName } = readSessionConfig();
	const login = await app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { email: user.email, password: user.password },
	});
	const session = login.cookies.find((c) => c.name === cookieName)?.value;
	if (!session) {
		throw new Error(`Sign-in failed: ${login.statusCode}`);
	}
	const csrf = await app.inject({
		method: "GET",
		url: "/csrf-token",
		cookies: { [cookieName]: session },
	});
	return {
		cookies: {
			[cookieName]: session,
			_csrf: csrf.cookies.find((c) => c.name === "_csrf")?.value ?? "",
		},
		headers: { "x-csrf-token": csrf.json<{ token: string }>().token },
	};
}

/** The whole API, configured like main.ts, ready for app.inject(). */
export async function startApp(): Promise<NestFastifyApplication> {
	const moduleRef = await Test.createTestingModule({
		imports: [AppModule],
	}).compile();
	const app = moduleRef.createNestApplication<NestFastifyApplication>(
		new FastifyAdapter(),
	);
	await configureApp(app);
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
	return app;
}

/** JSON requests to panel routes as a signed-in user. */
export function panelClient(app: NestFastifyApplication, auth: PanelAuth) {
	const call =
		(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE") =>
		(url: string, payload?: unknown) =>
			app.inject({
				method,
				url,
				payload: payload as object | undefined,
				cookies: auth.cookies,
				headers: auth.headers,
			});
	return {
		get: call("GET"),
		post: call("POST"),
		patch: call("PATCH"),
		put: call("PUT"),
		delete: call("DELETE"),
	};
}

export type PanelClient = ReturnType<typeof panelClient>;

/** GET requests to store routes of a tenant. */
export function storeClient(app: NestFastifyApplication, tenant: TestTenant) {
	return (url: string) =>
		app.inject({
			method: "GET",
			url,
			headers: { "x-tenant": tenant.slug },
		});
}

/** The tenant's domain events, oldest first. */
export function storeEvents(app: NestFastifyApplication, tenant: TestTenant) {
	return TenantContext.run(tenant, () =>
		app.get(TenantDatabase).run((tx) =>
			tx
				.select({
					type: domainEvents.type,
					payload: domainEvents.payload,
					dispatchedAt: domainEvents.dispatchedAt,
				})
				.from(domainEvents)
				.orderBy(asc(domainEvents.id)),
		),
	);
}

/**
 * The worker module with the given handlers, on queue keys of its own so no
 * other worker takes its jobs. Not started: call init() to run the relay and
 * the worker.
 */
export function testWorker(handlers: EventHandler[]) {
	return Test.createTestingModule({ imports: [WorkerModule] })
		.overrideProvider(QUEUE_OPTIONS)
		.useValue({
			...queueConnection(),
			prefix: `test-${crypto.randomUUID()}`,
		})
		.overrideProvider(EVENT_HANDLERS)
		.useValue(handlers)
		.compile();
}
