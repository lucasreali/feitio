# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

Everything internal to the system is written in English: identifiers (variables, functions, classes, files), code comments, docs and Markdown files, commit messages, PRs and issues.

## Repository state

`README.md` describes the target state and is the plan to follow: use its structure and conventions when creating apps, packages and modules. Today only `apps/api` exists. Not yet created: `apps/admin`, `apps/checkout`, anything under `packages/`, the root `dev`, `build` and `fix` scripts, and CI.

## Commands

- `pnpm check` (root) runs `biome check --write`: it formats and applies lint fixes to files. Run it after changing code.
- `pnpm test` (root) runs each project's `vitest.config.ts` under `apps/*` and `packages/*`. The api e2e suite is not included; run it with `pnpm --filter api test:e2e`.
- Vitest flags passed through pnpm need `--`: `pnpm test -- --reporter=verbose`. Without it, pnpm 12 parses the flag itself.

## API (`apps/api`)

- ESM with `module: nodenext`: local imports end in `.js`, including through the alias (`@/foo/bar.js`).
- The `@/*` alias maps to `src/*` (tsconfig `paths`, no `baseUrl`, which is deprecated in TS 6). `nest build` rewrites the alias to a relative path; Vitest resolves it via `vite-tsconfig-paths`.
- Runs on Fastify (`FastifyAdapter`), not Express. `@nestjs/platform-express` is in `node_modules` only as a peer of `@nestjs/core`; do not use Express APIs or types. E2E tests need `app.getHttpAdapter().getInstance().ready()` after `init()`.
- Biome's `useImportType` rule is off for the api: do not turn imports of injected classes into `import type`, it breaks Nest dependency injection.

## Dependencies

- Add or remove libraries only through pnpm (`pnpm --filter <project> add|remove <pkg>`, or `pnpm add -Dw` / `pnpm remove -w` at the root). Never edit dependencies in `package.json` by hand and then run `pnpm install`.
- Vitest, Biome and other shared tooling live only in the root `package.json` (`pnpm add -Dw`). Do not declare them in projects.
- Every new project with tests needs a `vitest.config.ts` with `name` and `root: import.meta.dirname`. With `root: "./"`, globs resolve from the directory the command runs in and pick up other projects' tests.

## Git

- Every commit follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope][!]: <description>`, optional body and footers, and `BREAKING CHANGE:` in a footer or `!` for breaking changes. Examples: `feat(api): ...`, `fix: ...`, `chore!: ...`.
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
