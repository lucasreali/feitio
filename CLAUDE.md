# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Each project has its own `CLAUDE.md` with the rules for its folder.

## Language

Everything internal to the system is written in English: identifiers, code comments, docs and Markdown files, commit messages, PRs and issues.

## Structure

pnpm monorepo. `README.md` describes the target state and is the plan to follow.

- `apps/api`: NestJS on Fastify, PostgreSQL with Drizzle, Valkey.
- `apps/admin` (port 3001) and `apps/checkout` (port 3002): React SPAs on Vite. Their shared rules are in `docs/ui-apps.md`.
- `packages/storefront-starter` (port 3003): TanStack Start template, copied out of the monorepo to start each client's store.
- `packages/config`: shared tsconfigs (`tsconfig.node.json`, `tsconfig.react.json`).
- `.github/workflows/ci.yml`: the `Checks` job runs Biome, build, unit tests and the API e2e suite (on the same `docker-compose.test.yml` services and `.env.test.example` values as a local run) on every pull request and push to `main`. Node comes from `.nvmrc`.

Not created yet: the root `dev` and `fix` scripts.

## Commands (from the root)

- `pnpm build`: every project's build.
- `pnpm dev:api`, `pnpm dev:admin`, `pnpm dev:checkout`, `pnpm dev:storefront`: one project in development. `pnpm dev:worker` runs the API's worker process (events and queues).
- `pnpm check`: `biome check --write` (formats and applies safe lint fixes).
- `pnpm test`: every project's unit and UI tests. The API integration and e2e suite is separate: `pnpm --filter api test:e2e`.
- `pnpm services:up` / `pnpm services:down`: local Valkey (Docker), for development.
- `pnpm --filter api test:e2e:setup`: starts the e2e suite's own disposable services (`apps/api/docker-compose.test.yml`: PostgreSQL, RustFS and Valkey) and prepares them (role, migrations, buckets); safe to run again. `pnpm --filter api test:services:down` removes them and their data. Without `docker` in the shell (WSL without Docker Desktop's integration), start that compose file from Docker Desktop and run `node scripts/e2e-setup.ts` in `apps/api`.
- pnpm 12 passes arguments to scripts as they are; do not add `--`, which makes Vitest ignore the filter. `--reporter` is the exception, because pnpm takes it for itself: use `pnpm exec vitest run ... --reporter=verbose`.

## Dependencies

- Add or remove packages only with pnpm: `pnpm --filter <project> add|remove <pkg>`, or `pnpm add -Dw` / `pnpm remove -w` at the root. Never edit dependencies in a `package.json` by hand.
- Shared tooling lives only in the root `package.json`: Biome, Vitest and TypeScript. Projects do not declare them.
- `pnpm-workspace.yaml` sets `saveExact` and `minimumReleaseAge` (7 days): versions are pinned, and a version published less than 7 days ago is refused (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). Pin the newest older version instead of relaxing the policy.
- Packages with install scripts must be listed in `allowBuilds` (`true` to run, `false` to deny).

## Adopting libraries

Installing a new library is always the developer's decision. This applies to every agent and developer and overrides an agent's autonomy. Each project's `CLAUDE.md` adds its own criteria.

1. **Need.** Before proposing a library, check in this order whether the need is already met by:
   - the language and the platform (Node, the browser);
   - what the project already has installed, including the framework in use;
   - a little code of our own, simple and testable.

   Propose a library only when none of these solves it well. Always use an established library, never our own code, for cryptography, password hashing, authentication protocols, payments and parsing complex formats (platform implementations such as `node:crypto` count as established). Never propose a library for the convenience of one function, or one that overlaps a library the project already uses.
2. **Choice.** Compare at least two alternatives, plus using no library, on:
   - maintenance: recent releases, answered issues, not abandoned or deprecated;
   - adoption and maintainer: widely used, maintained by a known organization or team;
   - stack fit: ES modules, bundled TypeScript types, the Node version in `.nvmrc`;
   - official ecosystem packages over community ports;
   - license: permissive (MIT, Apache, BSD, ISC); flag any other;
   - security: no open known vulnerability, few transitive dependencies, care with install scripts;
   - weight: final size and performance impact.

   Read the library's current docs instead of relying on memory: versions change.
3. **Ask first.** Before installing any new library, stop and present:
   - the need, and why the options in item 1 do not solve it;
   - the alternatives compared, on the criteria in item 2;
   - the recommendation, and what is lost by choosing it;
   - which project it goes into, and whether it is a production or development dependency.

   Install only after explicit approval. The same holds for replacing a library, removing one or bumping its major version. The only exception is the types package (`@types/...`) of an approved library.
4. **After approval.**
   - Install it in the project that uses it; the root only gets tooling every project uses.
   - If the library sets a convention (for example, "dates always with X"), add one line to that project's `CLAUDE.md`.

## Biome and Vitest

- One Biome config, `biome.json` at the root. It ignores gitignored files, `**/.claude`, `apps/api/drizzle` and `**/routeTree.gen.ts`.
- Vitest is installed only at the root. The root `vitest.config.ts` runs each project's `vitest.config.ts` as a Vitest project. A new project with tests needs its own `vitest.config.ts` with `name` and `root: import.meta.dirname`; with `root: "./"` its globs pick up other projects' tests.

## TDD

Every new piece of code is built test first.

### The cycle

1. Write a test that describes the behavior you want.
2. Run it and see it fail, for the reason you expect (not a typo or a missing import).
3. Write the least production code that makes it pass.
4. Refactor with the tests green.
5. Repeat for the next behavior.

### Rules

- No production code without a failing test that asks for it.
- A bug fix starts with a test that reproduces the bug.
- Tests check observable behavior (inputs, outputs, responses, what the user sees), not implementation details.
- A test you never saw fail is not trusted: make it fail once, for example by breaking the code it covers.
- A task is done only when every test in the monorepo passes: `pnpm test` and `pnpm --filter api test:e2e`.

### What to test

- API:
  - business rules: unit tests;
  - data access: integration tests against a real PostgreSQL, never a mocked database;
  - routes: end-to-end tests through the Fastify app.
  - Every new business table comes with a test proving tenants cannot see each other's rows.
- UIs: what the user sees and does, with Testing Library. Never test code generated by Kubb.

### Where tests live

- API unit tests: `apps/api/src/**/<name>.spec.ts`, next to the code.
- API integration and e2e tests: `apps/api/test/<module>/<name>.e2e-spec.ts`, in the folder of the `src/` module they cover. They read `apps/api/.env.test` (copy `.env.test.example`), never `.env`, and run against the local services of `pnpm --filter api test:e2e:setup`; the suite refuses to start when the database, S3 or Valkey are not local.
- UI tests: `src/**/<name>.test.ts(x)`, next to the code (jsdom + Testing Library).

### Commands

- Whole monorepo: `pnpm test`, then `pnpm --filter api test:e2e` (after `pnpm --filter api test:e2e:setup` once per session).
- One project: `pnpm test --project <name>` (`api`, `admin`, `checkout`, `storefront-starter`), or `pnpm --filter <project> test`.
- One file: `pnpm test <path>` from the root, or `pnpm --filter api test:e2e test/<module>/<name>.e2e-spec.ts` for an e2e file.
- One test by name: add `-t "<part of the name>"`.

## Git

- Never commit unless the user asks for it.
- Every commit follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope][!]: <description>`, optional body and footers, `BREAKING CHANGE:` or `!` for breaking changes.
- No mention of Claude, Claude Code or Anthropic in commits, PRs, issues or review comments: no `Co-Authored-By`, no "Generated with Claude Code", no attribution links or emojis.
- The main branch is `main`.

<!-- cortex:begin -->
## Cortex — decision memory

This project records its technical decisions with cortex (MCP server
`cortex`, tools: `save_decision`, `save_session_summary`,
`get_context`, `get_impact`, `search`, `search_all_projects`).

- Before proposing an approach or changing existing behavior, call
  `get_context` with your intent (or `search` with keywords) — a past
  decision may already govern this code.
- Before reworking code a decision anchors, call `get_impact` with the
  decision id to see everything the change touches.
- When the user confirms a non-obvious decision, save it with
  `save_decision`.
- When the session ends (or a milestone lands), persist an
  "Implemented / Decisions / Open" narrative with `save_session_summary`
  — the "Open" section is how the next session recovers unfinished work.
- Decision files live in `.cortex/decisions/` and are committed with the
  code they explain.
- If semantic search returns nothing useful, embeddings may be missing —
  suggest running `cortex embed --missing`.

More: https://github.com/lucasreali/cortex-cli#how-it-works
<!-- cortex:end -->
