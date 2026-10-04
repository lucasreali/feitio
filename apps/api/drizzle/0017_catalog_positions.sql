ALTER TABLE "facet_values" ADD COLUMN "position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD COLUMN "position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "product_options" ADD COLUMN "position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "position" integer NOT NULL;