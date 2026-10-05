-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' orders by accident.
ALTER TABLE orders FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE order_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE order_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches orders only through the tenant isolation
-- policies. Carts are removed (expired or with an erased customer), taking
-- their lines and history; the history is an append-only record.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders, order_lines TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE order_events TO feitio_app;--> statement-breakpoint
-- A removed customer or variant must leave the order and its lines in place:
-- set only the reference to null, never tenant_id (NOT NULL). Drizzle cannot
-- express the column list.
ALTER TABLE orders DROP CONSTRAINT orders_customer_fk;--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers (tenant_id, id) ON DELETE SET NULL (customer_id);--> statement-breakpoint
ALTER TABLE order_lines DROP CONSTRAINT order_lines_variant_fk;--> statement-breakpoint
ALTER TABLE order_lines ADD CONSTRAINT order_lines_variant_fk FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants (tenant_id, id) ON DELETE SET NULL (variant_id);
