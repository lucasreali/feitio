-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' customers by accident.
ALTER TABLE customers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_addresses FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_groups FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_group_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE customer_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches customers only through the tenant isolation
-- policies. Customers can be erased (LGPD), taking their rows with them; the
-- history is an append-only record.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE customers, customer_addresses, customer_groups TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE customer_group_members TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE customer_events TO feitio_app;
