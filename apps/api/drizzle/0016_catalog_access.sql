-- RLS also applies to the table owner, so not even the migration user reads
-- other tenants' catalog by accident.
ALTER TABLE products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_images FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_option_groups FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_options FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_variants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_variant_options FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE facets FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE facet_values FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE product_facet_values FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE collections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE collection_products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE collection_facet_values FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The application role reaches the catalog only through the tenant isolation
-- policies. Products are archived, never deleted; link tables are rewritten,
-- never updated.
GRANT SELECT, INSERT, UPDATE ON TABLE products TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE product_option_groups, product_options, product_variants, facets, facet_values, collections TO feitio_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE product_images, product_variant_options, product_facet_values, collection_products, collection_facet_values TO feitio_app;--> statement-breakpoint
-- Every product has at least one variant. Checked at commit, so a product and
-- its first variant can be inserted in either order, and from any write path.
CREATE FUNCTION product_has_variant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	target uuid;
BEGIN
	IF TG_TABLE_NAME = 'products' THEN
		target := NEW.id;
	ELSE
		target := OLD.product_id;
	END IF;
	-- Locks the product, so two transactions cannot each remove a different
	-- last variant. A product that is gone (tenant removal) needs no variant.
	PERFORM 1 FROM products WHERE id = target FOR UPDATE;
	IF FOUND AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = target) THEN
		RAISE EXCEPTION 'Product % has no variant', target USING ERRCODE = 'check_violation';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER products_have_a_variant
AFTER INSERT ON products
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION product_has_variant();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_variants_keep_one
AFTER DELETE OR UPDATE OF product_id ON product_variants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION product_has_variant();
