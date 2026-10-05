-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' events by accident.
ALTER TABLE domain_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE processed_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Events are append-only for the application: only the relay's dispatched_at
-- changes. Processed jobs are only ever added.
GRANT SELECT, INSERT ON TABLE domain_events, processed_jobs TO feitio_app;--> statement-breakpoint
GRANT UPDATE (dispatched_at) ON TABLE domain_events TO feitio_app;
