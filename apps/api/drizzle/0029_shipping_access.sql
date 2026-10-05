-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' shipping methods by accident.
ALTER TABLE shipping_methods FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches shipping methods only through the tenant
-- isolation policy. Methods are disabled, never removed: orders point at them.
GRANT SELECT, INSERT, UPDATE ON TABLE shipping_methods TO feitio_app;
