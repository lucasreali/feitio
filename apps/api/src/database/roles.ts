import { pgRole } from "drizzle-orm/pg-core";

/**
 * The role the API connects as (DATABASE_URL). It does not own the tables and
 * cannot bypass row-level security. Created by `pnpm db:roles`, not by migrations.
 */
export const APP_ROLE = "feitio_app";

export const appRole = pgRole(APP_ROLE).existing();
