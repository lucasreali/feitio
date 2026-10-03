import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { schemas } from "./schema.js";

/** Injection token for the Drizzle client. Inject it only in data access code. */
export const DATABASE = Symbol("DATABASE");

export type Database = NodePgDatabase<typeof schemas> & { $client: Pool };
