# CLAUDE.md (apps/admin)

The merchant's admin panel. Runs on port 3001 (`pnpm dev:admin` from the root). The root `CLAUDE.md` also applies.

@../../docs/ui-apps.md

- New libraries follow the root rule, and must also work with React and Vite, never be another component library besides Base UI, and be weighed by the size shipped to the browser.
- The Feitio palette in `src/styles.css` is fixed here: the panel is not themed per tenant.
