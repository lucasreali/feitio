ALTER TABLE "users" ADD COLUMN "cpf" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cpf_unique" UNIQUE("cpf");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cpf_digits" CHECK ("users"."cpf" ~ '^[0-9]{11}$');