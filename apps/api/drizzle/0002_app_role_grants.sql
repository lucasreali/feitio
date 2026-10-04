-- Access for the application role (feitio_app, created by `pnpm db:roles`).
-- There are no default privileges on purpose: a new business table stays
-- closed to the API until a migration gives it RLS policies and its own grants.
GRANT USAGE ON SCHEMA public TO feitio_app;--> statement-breakpoint
GRANT SELECT ON TABLE tenants TO feitio_app;
