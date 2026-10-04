-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' stock by accident.
ALTER TABLE stock_locations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_levels FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches stock only through the tenant isolation
-- policies. Levels are kept, never deleted (a variant's removal cascades), and
-- movements are an append-only record.
GRANT SELECT, INSERT ON TABLE stock_locations, stock_movements TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE stock_levels TO feitio_app;
