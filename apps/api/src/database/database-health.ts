import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "./database.js";

@Injectable()
export class DatabaseHealth {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async isReachable(): Promise<boolean> {
		try {
			await this.db.execute(sql`select 1`);
			return true;
		} catch {
			return false;
		}
	}
}
