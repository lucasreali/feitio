import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { users } from "../database/schemas/users.js";
import type { Email } from "../domain/email.js";
import type { UserId } from "../domain/ids.js";

export type User = typeof users.$inferSelect;

/** Reads admin panel users; a platform table, readable without a tenant. */
@Injectable()
export class UsersRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async findByEmail(email: Email): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		return user ?? null;
	}

	async findById(id: UserId): Promise<User | null> {
		const [user] = await this.db
			.select()
			.from(users)
			.where(eq(users.id, id))
			.limit(1);
		return user ?? null;
	}
}
