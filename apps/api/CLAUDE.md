# CLAUDE.md (apps/api)

Rules for the API. The root `CLAUDE.md` (structure, commands, dependencies, TDD, Git) also applies.

## Runtime and modules

- NestJS on Fastify. Use Fastify plugins (`@fastify/*`) registered in `configureApp()` (`src/app.setup.ts`), which `main.ts` and the e2e tests both call. Never add Express packages: no `cookie-parser`, `express-session`, `connect-redis`, Express `helmet`, `csurf`, `multer` or `@types/express`. `@nestjs/platform-express` is in `node_modules` only as a peer of `@nestjs/core`.
- ESM with `module: nodenext`: local imports end in `.js`, including through the `@/*` alias (`src/*`, tsconfig `paths`, no `baseUrl`). `nest build` rewrites the alias; Vitest resolves it with `vite-tsconfig-paths`.
- Biome's `useImportType` is off here: imports of injected classes must stay value imports, or Nest dependency injection breaks.
- OpenAPI comes from code: the `@nestjs/swagger` CLI plugin (`nest-cli.json`) reads controllers and `*.dto.ts` files at `nest build`/`nest start`, so DTOs need no `@ApiProperty` and JSDoc becomes descriptions. The plugin does not run under Vitest. The API serves `/openapi.json` and Swagger UI at `/docs`.
- `.env` lives in `apps/api` and is read with `process.loadEnvFile()` by `main.ts`, `drizzle.config.ts` and `scripts/`. The e2e Vitest config reads `.env.test` instead (see Tests). Configuration is read only through `src/config/config.ts`, never `process.env` elsewhere: `readConfig(env, sections)` validates each section (`server`, `database`, `migrations`, `storage`, `valkey`, `session`, `melhorEnvio`, `asaas`, `payments`) into a typed `AppConfig` and throws one error listing every problem (missing or empty, still the example's placeholder, a malformed URL or number; in production, vendor sandboxes and a webhook URL without https). `main.ts` and `worker.ts` check their whole set first (`startupConfig(API_SECTIONS)`, `WORKER_SECTIONS`) and exit with the list; modules read their own section with `configOf("<section>")`. A new variable goes into its section, with its check and a test in `config.spec.ts`.

## Adopting libraries

The root rule applies. Here a library must also work with NestJS on Fastify (Express packages do not), and an external vendor's SDK sits behind an interface we own, in an adapter (as `S3FileStorage` behind `FileStorage`).

## Fastify plugins

- `@fastify/helmet`: default policy on every response. Only routes under `/docs` drop `upgrade-insecure-requests` (Swagger UI over plain HTTP), through an `onRoute` hook registered before helmet. Do not relax it anywhere else.
- `@fastify/cookie`: signed cookies (`COOKIE_SECRET`).
- `@fastify/csrf-protection`: the secret sits in a signed `_csrf` cookie, and tokens are bound to the session that asked for them (`getUserInfo` plus an HMAC key derived from `COOKIE_SECRET`). `SessionGuard` checks `x-csrf-token` on `POST`, `PUT`, `PATCH` and `DELETE` (`src/session/csrf.ts` runs the plugin's own check); `GET /csrf-token` (session required) issues tokens. Routes without `SessionGuard` (tenant-header routes, `/health`, docs, webhooks) are exempt.
- `@fastify/multipart`: `MAX_UPLOAD_BYTES` (5 MB) per file; larger files fail with 413. Upload routes read the file with `request.file()` from a `FastifyRequest`.
- `@fastify/static`: serves the Swagger UI assets.

## Database

- PostgreSQL 17 (Supabase's major) with Drizzle. `src/database/schemas/` has one file per table (it exports the table and its enums, which is what drizzle-kit reads); `schema.ts` exports only the `schemas` object for the client. A new table needs its file and an entry in `schemas`.
- Migrations: change `src/database/schemas/`, then `pnpm db:generate --name <change>` and `pnpm db:migrate`. Never edit generated files in `drizzle/`. Grants and `FORCE ROW LEVEL SECURITY` go in custom migrations (`pnpm db:generate --custom --name <change>`).
- Two database users:
  - `feitio_app` (`DATABASE_URL`) is the API's user: it owns no table and cannot bypass RLS. `pnpm db:roles` creates or updates it from the name and password in `DATABASE_URL`.
  - The owner (`MIGRATION_DATABASE_URL`) runs `db:roles`, `db:migrate` and `db:seed`. On a new database, run `db:roles` before `db:migrate`.
- The e2e suite never uses Supabase: it runs on a disposable local PostgreSQL 17 (`docker-compose.test.yml`), which `pnpm test:e2e:setup` prepares with `db:roles` and `db:migrate`.
- Supabase: session pooler (port 5432; the 6543 transaction pooler breaks drizzle-kit's advisory lock), with `sslmode=verify-full&sslrootcert=certs/prod-ca-2021.crt`. The CA lives in `certs/` (gitignored); the path is relative to `apps/api`.
- Entity ids are UUID v7 (time-ordered). The database generates them with `uuid_generate_v7()` (migration 0005; PostgreSQL 17 has no built-in v7), and `tenants` refuses other versions on new rows (`CHECK ... NOT VALID`, so older v4 rows stay). In code, ids are branded types in `src/domain/ids.ts` with `generate()`. Never derive uniqueness from an id's prefix: in v7 it is the creation time.
- Vendor neutrality: Supabase is only plain PostgreSQL and S3, and nothing here is Supabase-specific. Never add `supabase-js` or another vendor SDK; switching providers must only change env vars.

## Tenants and data isolation

Each tenant is a merchant, and no tenant may read or change another's data. PostgreSQL enforces it with row-level security (RLS).

- Store and checkout routes use `@TenantScoped()` (`src/tenancy/`): it requires `X-Tenant` (the tenant's slug), resolves an active tenant (missing header: 400; unknown or inactive: the same 404) and runs the handler in `TenantContext` (`AsyncLocalStorage`), so the tenant is never passed around.
- Business tables are queried only through `TenantDatabase.run((tx) => ...)`, which opens a transaction and sets `app.tenant_id` with `set_config(..., true)` (transaction-local, safe with the pooler). It throws outside a tenant context. The raw `DATABASE` client is only for tenant-agnostic reads (health check, tenant resolution); on business tables it sees no rows.
- A new business table is born with:
  - an `id` of type `uuid` defaulting to `uuid_generate_v7()`, the same version check as `tenants`, and its own branded id type in `src/domain/ids.ts`;
  - a `tenant_id` column, `NOT NULL`, referencing `tenants`;
  - `tenantIsolation("<table>")` (`src/database/tenant-isolation.ts`) and `.enableRLS()` in its definition;
  - a custom migration with `FORCE ROW LEVEL SECURITY` and an explicit `GRANT ... TO feitio_app`;
  - an integration test proving isolation between tenants.

  - references to other business tables as composite foreign keys, `(tenant_id, x_id)` to a `(tenant_id, id)` unique key of the parent: foreign key checks skip RLS, so a plain `x_id` would accept another tenant's id. `test/database/catalog-schema.e2e-spec.ts` fails for any foreign key between two tables with `tenant_id` that leaves it out, and for any such table without forced RLS.

  There are no default privileges: a table without its grant stays closed to the API. Link tables (`product_images`, `collection_products`...) have a composite primary key instead of an `id`.
- `tenants` has RLS with a read-only policy for `feitio_app`; only the owner writes it.
- `users` (admin panel users) is a platform table like `tenants`: one user can belong to several tenants, the owner writes it and `feitio_app` only reads it. E-mails are stored lowercase (`Email` in `src/domain/email.ts`, plus a `CHECK`), the CPF is required, unique and stored as its 11 digits (`Cpf` in `src/domain/cpf.ts` checks the check digits), and passwords only as scrypt hashes (`src/auth/password.ts`, `node:crypto`, no dependency; 16 MiB per hash, so keep the low-memory cost).
- `memberships` ties a user to a tenant with a role (`owner` or `staff`). Besides `tenantIsolation`, it has a read-only policy on `app.user_id` (`currentUserId`), so sign-in can list a user's tenants before one is chosen; writes stay within the current tenant.

## File storage

- Inject the abstract `FileStorage` (`src/storage/file-storage.ts`), never `S3FileStorage`. `StorageModule` builds it from `STORAGE_*`.
- Two buckets by access type, never one per tenant: public (permanent URL from `STORAGE_PUBLIC_URL`) and private (only `temporaryUrl`, which always forces download).
- Keys are built only by `buildObjectKey` as `tenants/{tenantId}/{category}/{uuid}{ext}`; never accept a path from callers. Persist the returned `StoredFile` (`visibility` + `key`). `removeTenantFiles` wipes a tenant from both buckets.
- `upload` accepts only the types in `src/storage/file-types.ts` and derives the extension from the type. Never allow HTML or SVG. Never serve the buckets from a subdomain of a Feitio domain.
- Catalog images are assets (`src/assets/`, table `assets`, panel routes `GET /admin/assets` (newest first, paged), `POST /admin/assets` and `DELETE /admin/assets/:id`). The type comes from the file's first bytes (`detectImageType`), never from the type the client declares; anything else is 415. An asset row keeps only the key: assets are always public. Removal deletes the row and then the file in the same transaction, so a file that cannot be removed keeps its row.

## Catalog

- Products (`src/products/`): new products are drafts with a first variant; only `active` ones reach the stores, and `archived` replaces deletion. The slug is unique per store; left out, it comes from the name (`slugify`) with `-2`, `-3`... when taken. `description` is plain text.
- Every product has at least one variant (a deferred trigger refuses to commit one without; the API answers 409 before that), and the price (`Money`, integer cents) lives on the variant. A variant's options never change after creation, since stock and orders will point at its id: one option per group of its product, enforced by the composite keys of `product_variant_options`, and no two variants with the same options. A new option group gives its first option to every existing variant; a group can only be removed while all variants share one of its options.
- Writes to a product's structure lock the product row first (`lockProduct`), so checks such as "not the last variant" hold under concurrent requests.
- Order that people see (images, option groups, options, variants, facet values, collections) is a `position` column, never the id: UUID v7 ids made in the same millisecond have no order among themselves.
- Facets (`src/facets/`) are store-wide attributes with values, attached to products. A facet value a rule collection uses cannot be removed (409), nor can an asset a product or variant uses.
- Collections (`src/collections/`) are `manual` (products picked in order, `PUT /admin/collections/:id/products`) or `rule` (products with all the rule's facet values, worked out when read, never stored); the kind never changes. They nest through `parent_id`: a move goes after the new siblings and is refused (400) under itself or a descendant, and a collection with children cannot be removed (409). `PUT /admin/collections/order` takes every child of one parent in the new order. Tree changes hold a per-tenant transaction advisory lock.
- Store routes show only `active` products: `GET /store/products` (`ProductList`, one SQL query per page) filters by collection slug and by facet values (any value of a facet, every facet sent; an unknown value matches nothing), sorts by `newest`, `name`, `price-asc`/`price-desc` (each product's lowest variant price) or `position` (a manual collection's order, its default), and pages with `page`/`pageSize` (`parsePage`). `GET /store/products/:slug`, `/store/collections` and `/store/facets` complete the catalog for the stores.
- Panel sub-resource routes (options, variants) answer with the whole `ProductDto`. Database constraint violations become HTTP errors through `translateConstraints` (`src/database/pg-error.ts`), keyed by constraint name or SQLSTATE.

## Stock

- Stock (`src/stock/`) lives in `stock_levels`, per variant and location: `available` (can be sold) and `reserved` (held by orders awaiting payment); units in hand are their sum, and no row means nothing in stock. Each store has one default location (`stock_locations.is_default`, created with the first stock write); the model accepts more, and reads sum every location.
- Levels change only through `moveStock(tx, kind, lines)` (`src/stock/stock-ledger.ts`), inside the caller's transaction, which records one `stock_movements` row per change. Movements are append-only: `feitio_app` cannot update or delete them. Kinds: `adjustment` (signed, from the panel), `reservation` (order awaiting payment), `sale` (paid), `release` (cancelled or expired) and `return`.
- No overselling: each level changes in one conditional `UPDATE`, which PostgreSQL re-checks after a concurrent one, so two orders never take the last unit. Never read a level and write it back. `available` goes below zero only for a reservation of a variant that allows backorders; `reserved` never does (409). Lines lock in variant id order, so concurrent orders do not deadlock.
- Policy on `product_variants`: `track_stock` (default true; order movements skip untracked variants, adjustments always apply), `allow_backorder` and `low_stock_threshold` (null: never low).
- Panel routes: `GET` and `PATCH /admin/variants/:id/stock` (levels and policy), `POST /admin/variants/:id/stock/adjustments`, `GET /admin/variants/:id/stock/movements` (newest first, paged) and `GET /admin/stock/low` (tracked variants at or below their threshold, archived products left out, fewest units first).

## Customers

- Customers (`src/customers/`) are the stores' buyers, one per e-mail in each store. Without `password_hash` a customer is a guest (added by the panel, later by the checkout); with one they are registered and sign in to the store. Contact data uses the domain types (`Email`, `Phone`, `TaxId`); request bodies go through the parsers in `customer-input.ts`, shared by the panel and the stores.
- Addresses are Brazilian (`Cep`, `BrazilianState`, `number` as text for "s/n"). Each customer has at most one default shipping and one default billing address (partial unique indexes); setting a new default clears the old one, under `lockCustomer`. Addresses list defaults first, then oldest first.
- Panel routes: `GET /admin/customers` (newest first, paged, `q` searches name and e-mail with `%` and `_` as text), `GET`, `POST` and `PATCH /admin/customers/:id`, and `POST`, `PATCH` and `DELETE /admin/customers/:id/addresses/:addressId`; they answer with the whole `CustomerDto`, which never carries the password hash.
- Customer groups (`customer_groups`, for promotions and prices): `GET`, `POST`, `PATCH` (rename) and `DELETE /admin/customer-groups/:id`, names unique per store. A customer's groups are set with `groupIds` on `POST`/`PATCH /admin/customers` (the whole list; another store's group is 400), and `GET /admin/customers?groupId=` filters by group.
- Buyer sign-in (`/store/account/...`) is apart from the panel's, built for stores on their own domains: no cookie and no CSRF, but an opaque 256-bit token sent as `Authorization: Bearer`, with `X-Tenant` as in every store route. `CustomerSessions` keeps it in Valkey under its SHA-256 (`customer-session:<hash>`, 30-day sliding TTL, plus `customer-sessions:<customerId>` to end them all). Stores keep the token on their server, in an HttpOnly cookie of their own domain.
- Buyer routes use `@CustomerScoped()` and read the session with `@CurrentCustomer()`: `TenantGuard`, then `CustomerGuard`, which answers the same 401 to a missing, unknown or expired token and to a token of another store.
- `POST /store/account/register` answers 409 to any e-mail the store already has, guest or registered: taking over a guest would need proof of the e-mail, which waits for e-mail verification. `POST /store/account/login` gives the same 401 to wrong passwords, unknown e-mails and guests (decoy hash, `decoyPasswordHash`), with the panel's limits counted per store (`LoginAttempts` scope `store:<tenantId>`). Registrations are counted too (scope `store-register:<tenantId>`, never taken back: each one hashes a password), and so are wrong current passwords (`store-password:<tenantId>`, by customer and address). A password change (`POST /store/account/password`) ends every session and answers a new token. `GET`/`PATCH /store/account` (name, phone and tax id; not the e-mail) and `/store/account/addresses` complete the account.
- Every change to a customer adds an entry to `customer_events` with `recordEvent` (`src/customers/customer-history.ts`), in the transaction of the change: created, registered, profile and address changes (field names only, never values), password changes, groups joined and left, and staff notes. Repository writes take an `Actor`: the panel user's id, or null for the buyer. Entries are append-only and their `created_at` is `clock_timestamp()`, so the entries of one change keep their order. Panel routes: `GET /admin/customers/:id/history` (newest first, paged) and `POST /admin/customers/:id/notes`.
- LGPD requests reach the store, which answers them from the panel. `GET /admin/customers/:id/export` hands over everything kept about the customer as a JSON file (profile, addresses, groups, the whole history and their orders and carts; never the password hash). `DELETE /admin/customers/:id` (owners only) erases the customer: their carts, then the row and, by cascade, addresses, group memberships and history, then `CustomerSessions.destroyAll`. Delivered and cancelled orders stay for the store's records, detached from the customer and without their addresses, tracking code and label (`releaseCustomerOrders`); while an order is still to be paid or delivered, erasure answers 409. Data a new module keeps about a customer must reach the export and go away with the erasure.

## Orders

- Orders (`src/orders/`) follow Vendure: the cart is the order in state `cart`. A store starts one with `POST /store/cart`, which answers a random 256-bit token once; the table keeps only its SHA-256 (`token_hash`), and the store sends the token as `X-Cart-Token` (with `X-Tenant`) on every `/store/cart` route, also to follow the order after placing it. A missing, malformed or unknown token is 404. Stores keep the token on their server, like the buyer's.
- States (`src/orders/order-state.ts`): `cart`, `awaiting_payment`, `paid`, `preparing`, `shipped`, `delivered`, `cancelled`. Each transition says who may make it (buyer, staff or system) and its stock movement: placing reserves, going back to the cart or cancelling an unpaid order releases, payment sells, cancelling a paid or preparing order returns. Shipped orders are never cancelled.
- Every state change goes through `transitionOrder(tx, id, to, actor)` (`src/orders/order-transitions.ts`): it locks the order, checks the machine (409), moves the stock of the lines with `moveStock` (409 without stock), gives the number on the first placement, records the transition in `order_events` (with the panel user, or null for the buyer and the system) and publishes `order.transitioned`. Never update `orders.state` anywhere else.
- Only a cart changes (409 otherwise), under a lock on its row. Prices come from the catalog: after every change `reprice` drops lines of variants the store no longer sells (removed, or of a product that is not active), copies current prices, names and SKUs into the lines, and sums the totals. Adding past the available units of a tracked variant without backorders is 409; the reservation on placing checks again. A line holds up to 999 units; one line per variant.
- Totals are `Money` columns (integer cents) and a `CHECK` keeps `total = subtotal - discount + shipping`. Discount stays 0 until promotions arrive; shipping is the chosen method's price (see Shipping).
- `PUT /store/cart/customer` links the signed-in buyer (`Authorization: Bearer`, via `readCustomerSession`) or a guest by e-mail (`guestCustomer`): a new e-mail adds a guest customer, a known guest is linked as they are (anyone can type an e-mail, so the cart shows only the e-mail and never updates the guest), a registered buyer's e-mail is 409. Addresses (`PUT /store/cart/shipping-address`, `billing-address`) are copies in `jsonb`, never links to the address book.
- The checkout's steps are the cart routes; `missing` in the cart lists those a cart still needs, in order (`lines`, `customer`, `shipping_address` (none for pickup), `shipping_method`), worked out by `cartView` and empty once placed. `POST /store/cart/place` answers 409 while anything is missing, prices the cart again, prices its shipping for good (see Shipping) and moves it to `awaiting_payment`. The first placement gives the store's next number (from 1, under a per-store transaction advisory lock, so numbers never repeat nor skip; carts have none). `POST /store/cart/reopen` takes an unpaid order back to the cart, releasing its stock and keeping its number; with a payment pending or confirmed it is 409 (`transitionOrder` checks it), since the buyer could pay the old total.
- Lines keep copies of the product name, SKU and unit price. A removed customer or variant sets only that reference to null (`ON DELETE SET NULL (customer_id)` and `(variant_id)`, written in the custom migration since Drizzle cannot express the column list), so orders and lines stay.
- Panel routes: `GET /admin/orders` (newest placed first; carts only with `state=cart`; filters `state`, `customerId` and `q`, which is the number when it is digits alone and part of the e-mail otherwise), `GET /admin/orders/:id`, `POST /admin/orders/:id/transitions` (`{ state }`, cancelling included), `GET /admin/orders/:id/history`, `POST /admin/orders/:id/notes` (internal notes; the store's routes never show them) and `PUT /admin/orders/:id/shipment` (see Shipping). History entries are append-only, with `clock_timestamp()`.
- The worker's `OrderExpiry` runs every minute over the active stores, each in its own tenant context: orders awaiting payment for 24 hours are cancelled by the system (stock released), unless a payment is pending and its due date is less than 5 days past (a boleto takes days to clear), and carts untouched for 30 days are removed.

## Shipping

- Shipping methods (`src/shipping/`, table `shipping_methods`) have a name (unique per store, what the buyer sees), a `kind` that never changes, the kind's `config` and `enabled`. Methods are disabled, never removed (`feitio_app` has no `DELETE`): orders point at them. Panel routes: `GET /admin/shipping-methods` (by name) for any member; `POST` and `PATCH /admin/shipping-methods/:id` for owners only, since they set what buyers pay.
- Each kind is a `ShippingCalculator` in `src/shipping/adapters/` (`parseConfig` validates the panel's settings, `quote` prices a `Parcel` or answers null when it cannot ship it), registered in `SHIPPING_CALCULATORS` in `ShippingModule`. A new carrier is a new adapter, an enum value and a registry entry; the cart never changes. Kinds: `fixed` (`price`, optional `freeAbove` and `deliveryDays`), `melhor_envio` (`serviceId`, `originCep`) and `pickup` (free; the order needs no shipping address).
- Melhor Envio is called with Feitio's account (`MELHOR_ENVIO_URL`, `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_USER_AGENT`; the sandbox outside production), through the `fetch` in `MELHOR_ENVIO_API`, which e2e tests replace (`startApp(override)`). It needs every item's weight (grams) and dimensions (cm), set on the variant with `PATCH /admin/variants/:id`; without them, or without a CEP, the method is not offered. Use `custom_price` and `custom_delivery_time`, the account's.
- Carriers are called only by `ShippingQuotes`, outside any database transaction. `GET /store/cart/shipping-options[?cep=]` quotes every enabled method (to `cep`, else to the shipping address), cheapest first; a carrier that fails is logged and left out. `PUT /store/cart/shipping-method` quotes the one chosen (400 for a method the store does not offer, 409 when it cannot ship the cart, 502 when its carrier fails), then saves it in a second transaction only if the cart still matches what was quoted (409 otherwise).
- Quotes before placing are estimates: `GET /store/shipping-options?variantId=&cep=[&quantity=]` (a product page's simulation, no cart; 404 for a variant the store does not sell) and the cart's options. Shipping is priced for good when the order is placed: `checkout()` brings the cart up to date with the catalog, the controller quotes the chosen method for it outside any transaction, and `place()` saves that price only if the cart still matches (409 otherwise). A method no longer offered, or that cannot ship the cart, is dropped (409, the buyer chooses again); a carrier that fails is 502 and the cart stays. From then on the order's shipping never changes: the buyer never pays for later changes.
- The order keeps the method's id, a copy of its name and the quoted delivery days, and its price in `shipping`. Changing the lines, or the shipping address's CEP, clears the choice (`clearShipping`).
- Shipments: `PUT /admin/orders/:id/shipment` sets the carrier's tracking code (which the buyer sees in the cart) and the label's `HttpsUrl` (panel only) for orders paid to shipped (409 otherwise). The order's state is the shipment's situation. One shipment per order: split shipments would need a table of their own.

## Payments

- Payments (`src/payments/`) follow Vendure's Payment and Refund. The gateway sits behind `PaymentGateway` (`payment-gateway.ts`, token `PAYMENT_GATEWAY`): `createAccount`, `charge`, `find` (by the gateway's id or by our payment id, sent as the reference) and `refund`; it throws `GatewayRefusal` (a declined card, data it refuses; the message is for people) or any other error when it fails to answer. `AsaasGateway` (`adapters/asaas.ts`) is the one adapter, called with `fetch` from `ASAAS_API` (`ASAAS_URL`, `ASAAS_API_KEY`, `ASAAS_WALLET_ID`; the sandbox outside production), which e2e tests replace with `fakeAsaas()` (`test/payments/fake-asaas.ts`). Nothing outside `adapters/` knows Asaas.
- Each store charges in its own Asaas subaccount, and Feitio's part (`PAYMENT_FEE_PERCENT`, one fee for every store until plans) goes to Feitio's wallet as a split. `POST /admin/payments/account` (owners) opens the subaccount once with Feitio's key (409 for a second; 400 with Asaas's message when it refuses the data) and its webhook; `GET /admin/payments/account` shows its wallet. `payment_accounts` keeps the subaccount's key sealed with `SecretBox` (AES-256-GCM, `PAYMENT_SECRET_KEY`; never in clear, never answered) and the webhook token only as its SHA-256. Without an account the store takes no payments (409).
- `payments`: one charge of an order, `pending`, `confirmed`, `failed` or `refunded`, with its amount, what was refunded, the gateway's id, what the buyer pays with (`details`: Pix code and QR image, boleto line and URL, card brand and last digits) and the refusal's reason. A partial unique index keeps one payment pending or confirmed per order; failed ones stay. Every change of status and every refund joins the order's history (`order_events` kinds `payment` and `refund`).
- `POST /store/cart/payment` (cart token) charges an order awaiting payment for its total by `pix` (due today), `boleto` (due in 3 days) or `card`. The payment row comes first (so a second one is 409), then the gateway is called outside any transaction. A refusal answers the payment as `failed` with `failure`, and the buyer pays again; a gateway that does not answer is 502 and the payment stays pending for the reconciliation. The buyer's tax id (and, for cards, phone and the billing or shipping address) come from the order, or from the body when the store has none. `GET /store/cart/payment` shows the latest payment.
- Cards: the body's card goes to the gateway only, which tokenizes it and is charged by the token. Card data is never stored nor logged, and errors name card fields, never their values; keep it so (no logging of request bodies, of `ChargeInput`, or of the gateway's requests).
- Charging and marking paid are apart (SOLID): `Payments` charges; `settlePayment(tx, id, charge)` (`settle-payment.ts`) brings a payment up to what the gateway holds and, when it is confirmed, moves the order to `paid` with `transitionOrder` (system). Money for an order no longer awaiting payment (cancelled meanwhile) is only logged and recorded, for the staff to refund. It runs for the charge's answer, for webhooks and for the reconciliation; hearing the same thing twice changes nothing.
- Webhooks: `POST /webhooks/asaas/:tenantId` (no session, no CSRF, left out of Swagger) needs the store's token in `asaas-access-token` (401 otherwise, the same for every failure). Each notification about a payment is kept once by its id in `processed_jobs` (`asaas-webhook.<id>`) and published as `payment.notified` (the charge's gateway id); the worker's `PaymentNotifications` reads the charge from the gateway and settles it, so notifications out of order, repeated or forged never set a status the gateway does not hold. The webhook's URL is `PUBLIC_API_URL` plus the path.
- Refunds: `POST /admin/orders/:id/refunds` (owners; `{ amount }` in cents, or nothing for all that is left) refunds the order's confirmed payment at the gateway (409 without one, or with the gateway's refusal; 400 past what is left); the order's state stays, cancelling is apart. `GET /admin/orders/:id/payments` lists the order's payments, newest first.
- The worker's `PaymentReconciliation` runs every 5 minutes over the active stores: pending payments older than 10 minutes are read from the gateway and settled; one the gateway does not know after 30 minutes, or that it holds as pending but whose code never reached the buyer, is failed so the buyer pays again.
- A customer's export carries their orders' payments; erasure keeps them with the detached orders.

## Events and jobs

- Modules publish domain events (`DomainEvent`, `src/events/domain-event.ts`) with `publishEvent(tx, event)` in the transaction of the change: a transactional outbox (`domain_events`), so an event exists only if its change committed and is never lost after. Today: `product.created` (`ProductsRepository.create`), `stock.changed` (`moveStock`, with the lines that moved), `order.transitioned` (`transitionOrder`, with `from` and `to`; a payment is the transition to `paid`) and `payment.notified` (the Asaas webhook, with the charge's gateway id). Payloads carry ids and numbers only, never personal data: handlers read what they need.
- The worker is its own process (`src/worker.ts`, `WorkerModule`; `pnpm dev:worker`, `pnpm --filter api start:worker:prod`), with no HTTP server. The API never touches BullMQ. Besides events, it runs `OrderExpiry` (see Orders) and `PaymentReconciliation` (see Payments).
- `EventRelay` polls the outbox every second and puts each pending event on the BullMQ queue `events` as one job per `EventHandler` that takes its type (job id `<eventId>.<handler>`, so an event relayed twice still makes one job), then sets `dispatched_at`. It is the one reader across tenants: the `domain_events_relay_*` policies open the table (select, and update of `dispatched_at` only) to a transaction with `app.event_relay` set to `on`. Nothing else may set it.
- `EventJobs` runs each job in its event's `TenantContext`, inside a `TenantDatabase` transaction that first records `<eventId>.<handler>` in `processed_jobs`: a job delivered again (retry, stalled job) finds its key and changes nothing. A handler's writes go through the `tx` it gets; calls to a vendor send the `key` as the vendor's idempotency key.
- Jobs get 8 attempts with exponential waits from 2 s (`jobOptions`, `src/events/queue.ts`). A job that fails them all is logged and stays in the queue's failed set (the dead-letter queue) for 30 days, to be inspected and retried.
- A new handler implements `EventHandler` (unique, stable `name` without `:`) and joins `EVENT_HANDLERS` in `WorkerModule`. Tests use `testWorker(handlers)` (`test/fixtures.ts`), which gives the queue a random key prefix.

## Valkey and sessions

- Valkey is the in-memory store; there is no Redis. `ValkeyModule` provides the client (ioredis speaks the protocol); inject `Valkey` from `src/valkey/valkey.ts`. The server runs with `noeviction` (BullMQ needs it), so every cache key needs a TTL, and BullMQ queues must open their own connections with `maxRetriesPerRequest: null`.
- Admin panel authentication is a cookie session stored in Valkey (`src/session/`); there are no JWTs. Buyers in the stores have their own sessions (see Customers).
  - The signed cookie carries only a random 256-bit token. Valkey keeps the session (`userId`, `tenantId`, `createdAt`, `lastUsedAt`) under the token's SHA-256 (`session:<hash>`) with a sliding TTL, plus `user-sessions:<userId>` to end all of a user's sessions.
  - The cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when `NODE_ENV=production`; name, lifetime and domain come from `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS` and `SESSION_COOKIE_DOMAIN`.
  - Protect routes with `@UseGuards(SessionGuard)` and read the session with `@CurrentSession()`. Every authentication failure is the same generic 401; data-changing methods also need a CSRF token (403).
  - `SessionService.destroyAllForUser(userId)` ends every session of a user: call it on password change or account lock. Renewal only rewrites a session that still exists, so a session ended mid-request stays ended.

## Admin panel access

- Panel routes use `@PanelScoped()` or `@PanelScoped("owner")` (`src/auth/`), and their module imports `AuthModule`. It runs `SessionGuard` (session and CSRF) and then `PanelGuard`, which checks on every request that the user is still a member of the session's tenant and that the tenant is active (401 otherwise), and that the member has the route's role (403). The handler then runs in `TenantContext` with the session's tenant, like a `@TenantScoped()` route.
- `POST /auth/login` starts a session in the user's first active store and returns `MeDto`; wrong credentials, unknown e-mails and users without an active store get the same 401, and unknown e-mails still pay for a password check (decoy hash). `POST /auth/logout` and `POST /auth/logout-all` need the session and a CSRF token. `GET /auth/me` (`@PanelScoped()`) returns the same `MeDto`, which never carries the password hash or the CPF. `POST /auth/tenant` moves the session to another of the user's active stores by replacing it: the client gets a new cookie and must fetch a new CSRF token.
- Sign-in limits (`LoginAttempts`, Valkey, 15-minute windows): 5 attempts per e-mail and address, 100 per e-mail and 30 per address (IPv6 counted by /64, `ipBucket`); past any of them sign-in is refused (429 with `Retry-After`), even with the right password. Attempts are counted atomically before the password check, so parallel requests cannot slip past; a success takes its attempt back and resets the e-mail/address pair. The address is `request.ip`: behind a proxy, turn on Fastify's `trustProxy` first.
- Panel routes live under `/admin/...`; store routes keep the tenant from `X-Tenant`. Request bodies are validated by plain functions that return domain types or throw 400 (`parseStoreSettingsChanges`); DTO classes only describe the body for Swagger.
- `PATCH /admin/store/settings` (owners) changes the store name, logo (`HttpsUrl`) and theme (`ThemeValue`: plain CSS colors and lengths, no `;`, braces, quotes or `url()`).
- `pnpm store:create --slug <slug> --name <name> --owner-email <e-mail> [--owner-name <name> --owner-cpf <cpf>]` creates an active store with its settings and an owner: a new user gets a random password printed once; an existing user (by e-mail) keeps theirs. Commands that need the API's domain types live in `src/cli/` and run from `dist/` after `nest build`; `scripts/` stays for files Node runs straight from `.ts`.
- `MembershipsRepository` reads a user's memberships with `app.user_id` set, before a tenant is chosen.

## SOLID

SOLID is the default for API code. Every case still needs a cost/benefit call, and when you choose not to apply a principle, leave the reason in a short `SOLID:` comment in the code.

What each principle means here:

- **Single responsibility.** A class or function has one reason to change.
  - `TenantDatabase` only binds a transaction to the tenant.
  - The tenant resolver and the guard live apart.
  - `toStoreSettingsDto` (`src/store-settings/store-settings.mapper.ts`) keeps the response mapping out of the controller.
  - The payment module keeps "charge the card" (`Payments`) apart from "mark the order paid" (`settlePayment`).
- **Open/closed.** Extend by adding, not by editing what works.
  - Allowed upload types are data in `src/storage/file-types.ts`.
  - A new shipping carrier is a new `ShippingCalculator` adapter, without touching cart or checkout code.
- **Liskov substitution.** Any implementation honors its contract fully. A new `FileStorage` (for example, another S3 provider) must also refuse disallowed types, build keys with `buildObjectKey`, and make `temporaryUrl` force download.
- **Interface segregation.** Clients depend only on what they use. Split an interface when real callers need only part of it, not in advance: `FileStorage` stays whole until a caller needs only public files.
- **Dependency inversion.** Business code depends on abstractions it owns where a vendor or infrastructure can change.
  - `FileStorage` hides S3, and `S3FileStorage` receives its `S3Client` from `StorageModule`.
  - The payment gateway (Asaas today) sits behind `PaymentGateway`.

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

## Domain types for primitives

Wrapping primitives pays off for some values and weighs on the code if applied to everything.

- **Always wrap:**
  - **Money:** never a loose number. `Money` (`src/domain/money.ts`) is the amount as an integer number of cents and owns the operations, added as callers need them. Routes take and return prices as integer cents.
  - **Identifiers:** each entity has its own id type, so a tenant id cannot go where a user, session or order id is expected (`TenantId`, `UserId`, `SessionId`).
  - **Slugs and other public identifiers:** the type guarantees a valid format when created (`TenantSlug`, `Slug` for products and collections, `Sku`).
  - **Brazilian personal data:** `Cpf`, `Cnpj` (letters allowed in the first 12 characters since July 2026), `TaxId` (either one, told apart by length), `Phone` (stored in E.164, `+55...`), `Cep` (8 digits) and `BrazilianState` (`SP`, `DF`...). Each accepts the usual formatting and stores one spelling.
- **Do not wrap by default:** free text (names, descriptions, messages) and plain numbers (quantities, counters, positions).
- **Other cases:** wrap when the value has a format or validation rule, can be confused with another value of the same primitive, or carries its own operations. Keep the primitive when a new type would only add ceremony. Weigh type safety, clarity, simplicity and conversion cost, and leave the reason in a short comment when you keep a primitive that the rule would wrap.
- **How:**
  - Ids and slugs are branded types (`src/domain/`): plain strings at runtime, so they cost nothing and serialize as-is, but TypeScript keeps them apart.
  - Create them only through `parse` (throws on invalid input) or `tryParse` (returns null).
  - Drizzle columns declare them with `$type<...>()`, so values read from the database are already typed.
- **Boundary:** domain types live inside the API. Routes still take and return primitives, and the Swagger spec does not change.

## Tests

- Unit: `*.spec.ts` next to the code, in `src/` or `scripts/` (`pnpm test --project api`).
- Integration and e2e: `test/<module>/*.e2e-spec.ts`, mirroring `src/` (`test/auth/`, `test/assets/`...; `plugins.e2e-spec.ts` covers `src/app.setup.ts` and sits at the root) (`pnpm --filter api test:e2e`), against the real PostgreSQL (both database URLs), Valkey and S3 in `.env.test`. Tenant tests create random tenants as the owner and delete them at the end.
- Test services: `docker-compose.test.yml` (its own compose project: PostgreSQL 17 on 5433, RustFS on 9100, Valkey on 6380, nothing persisted), the same in CI. `pnpm test:e2e:setup` starts them, waits for them, runs `db:roles` and `db:migrate` and creates both buckets; it is idempotent. `pnpm test:services:down` throws them away.
- `.env.test` (from `.env.test.example`, the values CI uses) is the suite's only environment: `vitest.config.e2e.ts` loads it over the process's variables and fails without it, never falling back to `.env`. `scripts/test-env.ts` refuses a database URL or `STORAGE_ENDPOINT` not on `localhost`/`127.0.0.1`, and database 0 of the development Valkey (port 6379), so a wrong file never deletes real data.
- `test/fixtures.ts` creates tenants, users and memberships (`Fixtures`) and signs a user in to the panel with a CSRF token (`signIn`).
- `startApp()` and `testWorker()` run on a database pool of 3, and the suite runs 4 files at once (`maxWorkers`), each with up to 5 connections, well under the local PostgreSQL's 100.
