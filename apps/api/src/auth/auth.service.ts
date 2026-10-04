import { Injectable } from "@nestjs/common";
import { Email } from "../domain/email.js";
import type { UserId } from "../domain/ids.js";
import {
	type ActiveMembership,
	MembershipsRepository,
} from "./memberships.repository.js";
import { decoyPasswordHash, verifyPassword } from "./password.js";
import { type User, UsersRepository } from "./users.repository.js";

export interface Authenticated {
	user: User;
	/** At least one. */
	memberships: ActiveMembership[];
}

@Injectable()
export class AuthService {
	constructor(
		private readonly users: UsersRepository,
		private readonly memberships: MembershipsRepository,
	) {}

	/**
	 * The user behind these credentials with their active stores, or null
	 * when the e-mail or password is wrong or the user has no active store.
	 */
	async authenticate(
		email: string,
		password: string,
	): Promise<Authenticated | null> {
		const address = Email.tryParse(email);
		const user = address ? await this.users.findByEmail(address) : null;
		const matches = await verifyPassword(
			password,
			user?.passwordHash ?? (await decoyPasswordHash()),
		);
		if (!user || !matches) {
			return null;
		}
		const memberships = await this.memberships.listActive(user.id);
		return memberships.length > 0 ? { user, memberships } : null;
	}

	/** A signed-in user with their active stores, or null if the user is gone. */
	async load(userId: UserId): Promise<Authenticated | null> {
		const [user, memberships] = await Promise.all([
			this.users.findById(userId),
			this.memberships.listActive(userId),
		]);
		return user && memberships.length > 0 ? { user, memberships } : null;
	}
}
