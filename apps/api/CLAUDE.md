# CLAUDE.md (apps/api)

Rules for the API. The root `CLAUDE.md` (structure, commands, dependencies, TDD, Git) also applies.

## Runtime and modules

- NestJS on Fastify. Use Fastify plugins (`@fastify/*`) registered in `configureApp()` (`src/app.setup.ts`), which `main.ts` and the e2e tests both call. Never add Express packages: no `cookie-parser`, `express-session`, `connect-redis`, Express `helmet`, `csurf`, `multer` or `@types/express`. `@nestjs/platform-express` is in `node_modules` only as a peer of `@nestjs/core`.
- ESM with `module: nodenext`: local imports end in `.js`, including through the `@/*` alias (`src/*`, tsconfig `paths`, no `baseUrl`). `nest build` rewrites the alias; Vitest resolves it with `vite-tsconfig-paths`.
- Biome's `useImportType` is off here: imports of injected classes must stay value imports, or Nest dependency injection breaks.
- OpenAPI comes from code: the `@nestjs/swagger` CLI plugin (`nest-cli.json`) reads controllers and `*.dto.ts` files at `nest build`/`nest start`, so DTOs need no `@ApiProperty` and JSDoc becomes descriptions. The plugin does not run under Vitest. The API serves `/openapi.json` and Swagger UI at `/docs`.
- `.env` lives in `apps/api` and is read with `process.loadEnvFile()` by `main.ts`, `drizzle.config.ts`, `scripts/` and the e2e Vitest config. Each module fails at startup with a clear message when a variable it needs is missing (`DATABASE_URL`, `STORAGE_*`, `VALKEY_URL`, `COOKIE_SECRET`); read required variables with `requireEnv` (`src/config/env.ts`).

## Fastify plugins

- `@fastify/helmet`: default policy on every response. Only routes under `/docs` drop `upgrade-insecure-requests` (Swagger UI over plain HTTP), through an `onRoute` hook registered before helmet. Do not relax it anywhere else.
- `@fastify/cookie`: signed cookies (`COOKIE_SECRET`).
- `@fastify/csrf-protection`: the secret sits in a signed `_csrf` cookie, and tokens are bound to the session that asked for them (`getUserInfo` plus an HMAC key derived from `COOKIE_SECRET`). `SessionGuard` checks `x-csrf-token` on `POST`, `PUT`, `PATCH` and `DELETE` (`src/session/csrf.ts` runs the plugin's own check); `GET /csrf-token` (session required) issues tokens. Routes without `SessionGuard` (tenant-header routes, `/health`, docs, webhooks) are exempt.
- `@fastify/multipart`: `MAX_UPLOAD_BYTES` (5 MB) per file; larger files fail with 413. There are no upload routes yet.
- `@fastify/static`: serves the Swagger UI assets.

## Database

- PostgreSQL 17 (Supabase's major) with Drizzle. `src/database/schemas/` has one file per table (it exports the table and its enums, which is what drizzle-kit reads); `schema.ts` exports only the `schemas` object for the client. A new table needs its file and an entry in `schemas`.
- Migrations: change `src/database/schemas/`, then `pnpm db:generate --name <change>` and `pnpm db:migrate`. Never edit generated files in `drizzle/`. Grants and `FORCE ROW LEVEL SECURITY` go in custom migrations (`pnpm db:generate --custom --name <change>`).
- Two database users:
  - `feitio_app` (`DATABASE_URL`) is the API's user: it owns no table and cannot bypass RLS. `pnpm db:roles` creates or updates it from the name and password in `DATABASE_URL`.
  - The owner (`MIGRATION_DATABASE_URL`) runs `db:roles`, `db:migrate` and `db:seed`. On a new database, run `db:roles` before `db:migrate`.
- Supabase: session pooler (port 5432; the 6543 transaction pooler breaks drizzle-kit's advisory lock), with `sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt`. The CA lives in `certs/` (gitignored); the path is relative to `apps/api`.
- Vendor neutrality: Supabase is only plain PostgreSQL and S3, and nothing here is Supabase-specific. Never add `supabase-js` or another vendor SDK; switching providers must only change env vars.

## Tenants and data isolation

Each tenant is a merchant, and no tenant may read or change another's data. PostgreSQL enforces it with row-level security (RLS).

- Store and checkout routes use `@TenantScoped()` (`src/tenancy/`): it requires `X-Tenant` (the tenant's slug), resolves an active tenant (missing header: 400; unknown or inactive: the same 404) and runs the handler in `TenantContext` (`AsyncLocalStorage`), so the tenant is never passed around.
- Business tables are queried only through `TenantDatabase.run((tx) => ...)`, which opens a transaction and sets `app.tenant_id` with `set_config(..., true)` (transaction-local, safe with the pooler). It throws outside a tenant context. The raw `DATABASE` client is only for tenant-agnostic reads (health check, tenant resolution); on business tables it sees no rows.
- A new business table is born with:
  - a `tenant_id` column, `NOT NULL`, referencing `tenants`;
  - `tenantIsolation("<table>")` (`src/database/tenant-isolation.ts`) and `.enableRLS()` in its definition;
  - a custom migration with `FORCE ROW LEVEL SECURITY` and an explicit `GRANT ... TO feitio_app`;
  - an integration test proving isolation between tenants.

  There are no default privileges: a table without its grant stays closed to the API.
- `tenants` has RLS with a read-only policy for `feitio_app`; only the owner writes it.

## File storage

- Inject the abstract `FileStorage` (`src/storage/file-storage.ts`), never `S3FileStorage`. `StorageModule` builds it from `STORAGE_*`.
- Two buckets by access type, never one per tenant: public (permanent URL from `STORAGE_PUBLIC_URL`) and private (only `temporaryUrl`, which always forces download).
- Keys are built only by `buildObjectKey` as `tenants/{tenantId}/{category}/{uuid}{ext}`; never accept a path from callers. Persist the returned `StoredFile` (`visibility` + `key`). `removeTenantFiles` wipes a tenant from both buckets.
- `upload` accepts only the types in `src/storage/file-types.ts` and derives the extension from the type. Never allow HTML or SVG. Never serve the buckets from a subdomain of a Feitio domain.

## Valkey and sessions

- Valkey is the in-memory store; there is no Redis. `ValkeyModule` provides the client (ioredis speaks the protocol); inject `Valkey` from `src/valkey/valkey.ts`. The server runs with `noeviction` (BullMQ needs it), so every cache key needs a TTL, and BullMQ queues must open their own connections with `maxRetriesPerRequest: null`.
- Admin panel authentication is a cookie session stored in Valkey (`src/session/`); there are no JWTs. Buyer sessions in the stores, when they come, are a separate thing.
  - The signed cookie carries only a random 256-bit token. Valkey keeps the session (`userId`, `tenantId`, `createdAt`, `lastUsedAt`) under the token's SHA-256 (`session:<hash>`) with a sliding TTL, plus `user-sessions:<userId>` to end all of a user's sessions.
  - The cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when `NODE_ENV=production`; name, lifetime and domain come from `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS` and `SESSION_COOKIE_DOMAIN`.
  - Protect routes with `@UseGuards(SessionGuard)` and read the session with `@CurrentSession()`. Every authentication failure is the same generic 401; data-changing methods also need a CSRF token (403).
  - `SessionService.destroyAllForUser(userId)` ends every session of a user: call it on password change or account lock. Renewal only rewrites a session that still exists, so a session ended mid-request stays ended.

## SOLID

SOLID is the default for API code. Every case still needs a cost/benefit call, and when you choose not to apply a principle, leave the reason in a short `SOLID:` comment in the code.

What each principle means here:

- **Single responsibility.** A class or function has one reason to change.
  - `TenantDatabase` only binds a transaction to the tenant.
  - The tenant resolver and the guard live apart.
  - `toStoreSettingsDto` (`src/store-settings/store-settings.mapper.ts`) keeps the response mapping out of the controller.
  - A future payment module keeps "charge the card" apart from "mark the order paid".
- **Open/closed.** Extend by adding, not by editing what works.
  - Allowed upload types are data in `src/storage/file-types.ts`.
  - A new shipping carrier will be a new class behind the shipping interface, without touching checkout code.
- **Liskov substitution.** Any implementation honors its contract fully. A new `FileStorage` (for example, another S3 provider) must also refuse disallowed types, build keys with `buildObjectKey`, and make `temporaryUrl` force download.
- **Interface segregation.** Clients depend only on what they use. Split an interface when real callers need only part of it, not in advance: `FileStorage` stays whole until a caller needs only public files.
- **Dependency inversion.** Business code depends on abstractions it owns where a vendor or infrastructure can change.
  - `FileStorage` hides S3, and `S3FileStorage` receives its `S3Client` from `StorageModule`.
  - A payment gateway (Asaas today) will sit behind a payment interface.

How to decide, for each case:

- **Organization:** does the split make the code easier to find and understand?
- **Coupling:** does it reduce dependence between modules, or on a vendor?
- **Testability:** can the rule be tested without infrastructure?
- **Simplicity:** does the abstraction pay for itself, or only add files and indirection?
- **Performance:** does it add real cost on a hot path?
- **Real chance of change:** does this point vary (payment, shipping, storage, fiscal documents) or is it stable?

Prefer the direct solution when an abstraction would have a single implementation that should not vary, when a layer would only forward calls, or when the generalization serves an uncertain future. Kept deviations today, each with its `SOLID:` comment:

- `SessionService`: storage and cookie together.
- `SessionGuard`: session and CSRF together.
- `HealthController`: concrete checks.
- `TenantDatabase`: no interface.
- `FileStorage`: one interface.
- `Valkey`: the full client.

## Tests

- Unit: `src/**/*.spec.ts` (`pnpm test --project api`).
- Integration and e2e: `test/*.e2e-spec.ts` (`pnpm --filter api test:e2e`), against the real PostgreSQL (both database URLs), Valkey and S3 in `.env`. Tenant tests create random tenants as the owner and delete them at the end.
