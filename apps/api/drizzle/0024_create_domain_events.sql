CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "domain_events_id_uuid_v7" CHECK (coalesce(uuid_extract_version("domain_events"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "processed_jobs" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_jobs_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
ALTER TABLE "processed_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_jobs" ADD CONSTRAINT "processed_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("id") WHERE "domain_events"."dispatched_at" is null;--> statement-breakpoint
CREATE POLICY "domain_events_tenant_isolation" ON "domain_events" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "domain_events_relay_read" ON "domain_events" AS PERMISSIVE FOR SELECT TO "feitio_app" USING (current_setting('app.event_relay', true) = 'on');--> statement-breakpoint
CREATE POLICY "domain_events_relay_dispatch" ON "domain_events" AS PERMISSIVE FOR UPDATE TO "feitio_app" USING (current_setting('app.event_relay', true) = 'on') WITH CHECK (current_setting('app.event_relay', true) = 'on');--> statement-breakpoint
CREATE POLICY "processed_jobs_tenant_isolation" ON "processed_jobs" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);