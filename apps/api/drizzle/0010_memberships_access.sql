-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' memberships by accident.
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches memberships only through its policies: the
-- current tenant's rows, plus reading the current user's own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memberships TO feitio_app;
