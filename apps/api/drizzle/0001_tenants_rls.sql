ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenants_app_read" ON "tenants" AS PERMISSIVE FOR SELECT TO "feitio_app" USING (true);