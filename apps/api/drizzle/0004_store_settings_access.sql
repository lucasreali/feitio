-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' settings by accident.
ALTER TABLE store_settings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches store_settings only through the
-- store_settings_tenant_isolation policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE store_settings TO feitio_app;
