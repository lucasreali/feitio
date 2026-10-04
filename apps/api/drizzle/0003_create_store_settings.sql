CREATE TABLE "store_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"logo_url" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "store_settings_tenant_isolation" ON "store_settings" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);