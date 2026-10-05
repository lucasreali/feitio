CREATE TYPE "public"."shipping_kind" AS ENUM('fixed', 'melhor_envio', 'pickup');--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "shipping_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shipping_methods_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "shipping_methods_id_uuid_v7" CHECK (coalesce(uuid_extract_version("shipping_methods"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "shipping_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_method_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_method_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_delivery_days" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "weight" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "length" integer;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_method_fk" FOREIGN KEY ("tenant_id","shipping_method_id") REFERENCES "public"."shipping_methods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_delivery_days_positive" CHECK ("orders"."shipping_delivery_days" > 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_method_named" CHECK (("orders"."shipping_method_id" is null) = ("orders"."shipping_method_name" is null));--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_size_positive" CHECK ("product_variants"."weight" > 0 and "product_variants"."height" > 0 and "product_variants"."width" > 0 and "product_variants"."length" > 0);--> statement-breakpoint
CREATE POLICY "shipping_methods_tenant_isolation" ON "shipping_methods" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);