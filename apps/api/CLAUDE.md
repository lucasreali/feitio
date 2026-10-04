# CLAUDE.md (apps/api)

Guidance for Claude Code when working in the API. The root `CLAUDE.md` still applies.

## Fastify, not Express

The API runs on Fastify. Use Fastify plugins (`@fastify/*`), registered in `configureApp()` (`src/app.setup.ts`), which both `main.ts` and the e2e tests call. Never add Express packages or middleware: no `cookie-parser`, `express-session`, `connect-redis`, `helmet` (the Express one), `csurf`, `multer` or `@types/express`.

Plugins in use:

- `@fastify/helmet`: security headers on every response with Helmet's default policy. Only routes under `/docs` (Swagger UI) get a Content-Security-Policy without `upgrade-insecure-requests`, set through an `onRoute` hook registered before helmet. Do not relax the policy anywhere else.
- `@fastify/cookie`: signed cookies (`COOKIE_SECRET`).
- `@fastify/csrf-protection`: CSRF secret in a signed `_csrf` cookie, and tokens bound to the session that asked for them (`getUserInfo` + an HMAC key derived from `COOKIE_SECRET`), so a token from another session or a planted secret is refused. `SessionGuard` checks the `x-csrf-token` header on `POST`, `PUT`, `PATCH` and `DELETE` (`src/session/csrf.ts` runs the plugin's own check); the UIs get tokens from `GET /csrf-token`, which requires a session. Routes without `SessionGuard` (tenant-header routes, `/health`, docs, webhooks) are exempt by construction.
- `@fastify/multipart`: uploads limited to `MAX_UPLOAD_BYTES` (5 MB) per file; larger files fail with 413. There are no upload routes yet.
- `@fastify/static`: serves the Swagger UI assets.

## Valkey

Valkey is the in-memory store; there is no Redis. `ValkeyModule` (`src/valkey/`) provides the shared client from `VALKEY_URL`; inject `Valkey` from `src/valkey/valkey.ts`.

## Tenants and data isolation

Each tenant is a merchant, and a tenant must never read or change another tenant's data. PostgreSQL enforces it with row-level security (RLS):

- **Requests.** Store and checkout routes use `@TenantScoped()` (`src/tenancy/`). It requires the `X-Tenant` header (the tenant's slug), resolves it to an active tenant (missing header: 400; unknown or inactive: the same 404) and runs the handler inside `TenantContext` (`AsyncLocalStorage`), so the tenant never has to be passed around. Routes that belong to no tenant, such as `/health` and the docs, do not use it.
- **Queries.** All access to business tables goes through `TenantDatabase.run((tx) => ...)`. It opens a transaction, sets `app.tenant_id` with `set_config(..., true)` (transaction-local, safe with the session pooler) and runs the callback. It throws outside a tenant context. Never query business tables with the raw `DATABASE` client: RLS returns no rows there anyway.
- **New business tables** are born with:
  - a `tenant_id` column, `NOT NULL` and referencing `tenants`;
  - `tenantIsolation("<table>")` (`src/database/tenant-isolation.ts`) in the table definition, and `.enableRLS()`;
  - a custom migration (`pnpm db:generate --custom --name ...`) with `ALTER TABLE ... FORCE ROW LEVEL SECURITY` and an explicit `GRANT ... TO feitio_app`.
  There are no default privileges, so a table without its grant stays closed to the API.
- **Database users.**
  - The API connects as `feitio_app` (`DATABASE_URL`), which owns no table and has no `BYPASSRLS`.
  - `pnpm db:roles` creates or updates it from the name and password in `DATABASE_URL`.
  - Migrations, `db:roles` and `db:seed` connect as the owner (`MIGRATION_DATABASE_URL`).
  - `tenants` itself has RLS with a read-only policy for `feitio_app`; only the owner writes it.
- Nothing here is Supabase-specific; it runs on any PostgreSQL, including through a session-mode pooler.

## Admin panel authentication: sessions in Valkey with a cookie

- Admin users authenticate with a cookie session stored in Valkey (`src/session/`). There are no JWTs.
- The cookie (`@fastify/cookie`, signed with `COOKIE_SECRET`) only carries a random 256-bit token. Valkey stores the session under the token's SHA-256 (`session:<hash>`) with a TTL, plus a per-user index (`user-sessions:<userId>`) used to end every session of a user.
- A session holds `userId`, `tenantId`, `createdAt` and `lastUsedAt`. Every use renews the TTL and the cookie (sliding expiration, `SESSION_TTL_SECONDS`).
- The cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when `NODE_ENV=production`; name, lifetime and domain come from `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS` and `SESSION_COOKIE_DOMAIN`.
- Protect routes with `@UseGuards(SessionGuard)` and read the session with `@CurrentSession()`. Missing, tampered, unknown or expired sessions get a generic `401 Unauthorized`; never reveal which one. Data-changing methods also need a CSRF token (403 without it).
- `SessionService`: `create(reply, { userId, tenantId })` starts a session and sets the cookie, `readFromCookie(request, reply)` reads and renews it, `destroy(request, reply)` ends the current one, and `destroyAllForUser(userId)` ends all of a user's sessions (use it on password change or account lock).
- Store sessions buyers use in the stores separately; this module is for the admin panel.

## Tests

The e2e suite (`pnpm --filter api test:e2e`) runs against the real services in `.env`:

- the PostgreSQL behind both database URLs;
- Valkey (`pnpm services:up`);
- the S3 storage.

The tenant tests create random tenants as the owner and delete them at the end.
