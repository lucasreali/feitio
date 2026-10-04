CREATE TYPE "public"."collection_kind" AS ENUM('manual', 'rule');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "collection_facet_values" (
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"facet_value_id" uuid NOT NULL,
	CONSTRAINT "collection_facet_values_collection_id_facet_value_id_pk" PRIMARY KEY("collection_id","facet_value_id")
);
--> statement-breakpoint
ALTER TABLE "collection_facet_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collection_products" (
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collection_products_collection_id_product_id_pk" PRIMARY KEY("collection_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "collection_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" "collection_kind" NOT NULL,
	"parent_id" uuid,
	"position" integer NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "collections_tenant_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "collections_id_uuid_v7" CHECK (coalesce(uuid_extract_version("collections"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "facet_values" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"facet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facet_values_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "facet_values_facet_name_unique" UNIQUE("facet_id","name"),
	CONSTRAINT "facet_values_id_uuid_v7" CHECK (coalesce(uuid_extract_version("facet_values"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "facet_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "facets" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facets_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "facets_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "facets_id_uuid_v7" CHECK (coalesce(uuid_extract_version("facets"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "facets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_facet_values" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"facet_value_id" uuid NOT NULL,
	CONSTRAINT "product_facet_values_product_id_facet_value_id_pk" PRIMARY KEY("product_id","facet_value_id")
);
--> statement-breakpoint
ALTER TABLE "product_facet_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_images" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "product_images_product_id_asset_id_pk" PRIMARY KEY("product_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_groups_tenant_product_id_unique" UNIQUE("tenant_id","product_id","id"),
	CONSTRAINT "product_option_groups_product_name_unique" UNIQUE("product_id","name"),
	CONSTRAINT "product_option_groups_id_uuid_v7" CHECK (coalesce(uuid_extract_version("product_option_groups"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "product_option_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_options_tenant_product_group_id_unique" UNIQUE("tenant_id","product_id","group_id","id"),
	CONSTRAINT "product_options_group_name_unique" UNIQUE("group_id","name"),
	CONSTRAINT "product_options_id_uuid_v7" CHECK (coalesce(uuid_extract_version("product_options"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "product_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variant_options" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "product_variant_options_variant_id_group_id_pk" PRIMARY KEY("variant_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "product_variant_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"price" integer NOT NULL,
	"asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_tenant_product_id_unique" UNIQUE("tenant_id","product_id","id"),
	CONSTRAINT "product_variants_tenant_sku_unique" UNIQUE("tenant_id","sku"),
	CONSTRAINT "product_variants_price_not_negative" CHECK ("product_variants"."price" >= 0),
	CONSTRAINT "product_variants_id_uuid_v7" CHECK (coalesce(uuid_extract_version("product_variants"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "products_tenant_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "products_id_uuid_v7" CHECK (coalesce(uuid_extract_version("products"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_facet_values" ADD CONSTRAINT "collection_facet_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_facet_values" ADD CONSTRAINT "collection_facet_values_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "public"."collections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_facet_values" ADD CONSTRAINT "collection_facet_values_value_fk" FOREIGN KEY ("tenant_id","facet_value_id") REFERENCES "public"."facet_values"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "public"."collections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."collections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facet_values" ADD CONSTRAINT "facet_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facet_values" ADD CONSTRAINT "facet_values_facet_fk" FOREIGN KEY ("tenant_id","facet_id") REFERENCES "public"."facets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facets" ADD CONSTRAINT "facets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_facet_values" ADD CONSTRAINT "product_facet_values_value_fk" FOREIGN KEY ("tenant_id","facet_value_id") REFERENCES "public"."facet_values"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_group_fk" FOREIGN KEY ("tenant_id","product_id","group_id") REFERENCES "public"."product_option_groups"("tenant_id","product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_variant_fk" FOREIGN KEY ("tenant_id","product_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_option_fk" FOREIGN KEY ("tenant_id","product_id","group_id","option_id") REFERENCES "public"."product_options"("tenant_id","product_id","group_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_facet_values_value_idx" ON "product_facet_values" USING btree ("facet_value_id","product_id");--> statement-breakpoint
CREATE POLICY "collection_facet_values_tenant_isolation" ON "collection_facet_values" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "collection_products_tenant_isolation" ON "collection_products" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "collections_tenant_isolation" ON "collections" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "facet_values_tenant_isolation" ON "facet_values" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "facets_tenant_isolation" ON "facets" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_facet_values_tenant_isolation" ON "product_facet_values" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_images_tenant_isolation" ON "product_images" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_option_groups_tenant_isolation" ON "product_option_groups" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_options_tenant_isolation" ON "product_options" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_variant_options_tenant_isolation" ON "product_variant_options" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_variants_tenant_isolation" ON "product_variants" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);