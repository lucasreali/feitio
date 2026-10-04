# CLAUDE.md (apps/checkout)

The single checkout shared by every store. Runs on port 3002 (`pnpm dev:checkout` from the root). The root `CLAUDE.md` also applies.

@../../docs/ui-apps.md

- New libraries follow the root rule, and must also work with React and Vite, never be another component library besides Base UI, and be weighed by the size shipped to the browser.
- The Feitio palette in `src/styles.css` is only the default. `applyTheme()` in `src/theme.ts` is the single place where a tenant's colors override the CSS variables on `<html>`; `src/main.tsx` marks where it will be called, before the first render. Loading the tenant's theme is not implemented yet.
