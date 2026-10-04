CREATE TYPE "public"."customer_event_kind" AS ENUM('created', 'registered', 'profile_updated', 'password_changed', 'address_added', 'address_updated', 'address_removed', 'added_to_group', 'removed_from_group', 'note');--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"phone" text,
	"cep" text NOT NULL,
	"street" text NOT NULL,
	"number" text NOT NULL,
	"complement" text,
	"neighborhood" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_cep_digits" CHECK ("customer_addresses"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "customer_addresses_state_format" CHECK ("customer_addresses"."state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "customer_addresses_phone_e164" CHECK ("customer_addresses"."phone" ~ '^\+55[0-9]{10,11}$'),
	CONSTRAINT "customer_addresses_id_uuid_v7" CHECK (coalesce(uuid_extract_version("customer_addresses"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "customer_event_kind" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_events_id_uuid_v7" CHECK (coalesce(uuid_extract_version("customer_events"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "customer_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_group_members" (
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	CONSTRAINT "customer_group_members_group_id_customer_id_pk" PRIMARY KEY("group_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "customer_group_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_groups_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_groups_tenant_name_unique" UNIQUE("tenant_id","name"),
	CONSTRAINT "customer_groups_id_uuid_v7" CHECK (coalesce(uuid_extract_version("customer_groups"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "customer_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"tax_id" text,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "customers_tenant_email_unique" UNIQUE("tenant_id","email"),
	CONSTRAINT "customers_email_lowercase" CHECK ("customers"."email" = lower("customers"."email")),
	CONSTRAINT "customers_phone_e164" CHECK ("customers"."phone" ~ '^\+55[0-9]{10,11}$'),
	CONSTRAINT "customers_tax_id_format" CHECK ("customers"."tax_id" ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
	CONSTRAINT "customers_id_uuid_v7" CHECK (coalesce(uuid_extract_version("customers"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_members" ADD CONSTRAINT "customer_group_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_members" ADD CONSTRAINT "customer_group_members_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."customer_groups"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_group_members" ADD CONSTRAINT "customer_group_members_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_one_default_shipping" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_shipping";--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_one_default_billing" ON "customer_addresses" USING btree ("customer_id") WHERE "customer_addresses"."is_default_billing";--> statement-breakpoint
CREATE INDEX "customer_events_customer_idx" ON "customer_events" USING btree ("customer_id","id");--> statement-breakpoint
CREATE INDEX "customer_group_members_customer_idx" ON "customer_group_members" USING btree ("customer_id");--> statement-breakpoint
CREATE POLICY "customer_addresses_tenant_isolation" ON "customer_addresses" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "customer_events_tenant_isolation" ON "customer_events" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "customer_group_members_tenant_isolation" ON "customer_group_members" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "customer_groups_tenant_isolation" ON "customer_groups" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "customers_tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);