-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' assets by accident.
ALTER TABLE assets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches assets only through the
-- assets_tenant_isolation policy.
GRANT SELECT, INSERT, DELETE ON TABLE assets TO feitio_app;
