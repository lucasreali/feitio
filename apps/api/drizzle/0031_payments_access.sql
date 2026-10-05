-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' payments or gateway accounts by accident.
ALTER TABLE payment_accounts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches them only through the tenant isolation
-- policies. Accounts are created once; payments are the record of what was
-- charged and refunded: neither is removed (orders removed take their
-- payments by cascade).
GRANT SELECT, INSERT ON TABLE payment_accounts TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE payments TO feitio_app;
