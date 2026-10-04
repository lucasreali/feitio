ALTER TABLE "product_variants" ADD COLUMN "track_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "allow_backorder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "low_stock_threshold" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_low_stock_threshold_not_negative" CHECK ("product_variants"."low_stock_threshold" >= 0);