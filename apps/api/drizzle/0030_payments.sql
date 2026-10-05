CREATE TYPE "public"."payment_method" AS ENUM('pix', 'boleto', 'card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'payment';--> statement-breakpoint
ALTER TYPE "public"."order_event_kind" ADD VALUE 'refund';--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gateway_account_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"credential" text NOT NULL,
	"webhook_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_tenant_unique" UNIQUE("tenant_id"),
	CONSTRAINT "payment_accounts_id_uuid_v7" CHECK (coalesce(uuid_extract_version("payment_accounts"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"refunded" integer DEFAULT 0 NOT NULL,
	"gateway_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure" text,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_gateway_id_unique" UNIQUE("tenant_id","gateway_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_refunded_within_amount" CHECK ("payments"."refunded" between 0 and "payments"."amount"),
	CONSTRAINT "payments_id_uuid_v7" CHECK (coalesce(uuid_extract_version("payments"."id"), 0) = 7)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_open_unique" ON "payments" USING btree ("tenant_id","order_id") WHERE "payments"."status" in ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE POLICY "payment_accounts_tenant_isolation" ON "payment_accounts" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "payments_tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "feitio_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);