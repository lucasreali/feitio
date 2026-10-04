import { Injectable } from "@nestjs/common";
import {
	decoyPasswordHash,
	hashPassword,
	verifyPassword,
} from "../auth/password.js";
import { Email } from "../domain/email.js";
import type { CustomerId } from "../domain/ids.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import type { Registration } from "./customer-input.js";
import { CustomerSessions } from "./customer-sessions.js";
import { CustomersRepository } from "./customers.repository.js";

/** Sign-up, sign-in and passwords of the current store's buyers. */
@Injectable()
export class CustomerAuth {
	constructor(
		private readonly customers: CustomersRepository,
		private readonly sessions: CustomerSessions,
	) {}

	/** Creates the account and signs the buyer in; 409 for an e-mail the store has. */
	async register({ password, ...profile }: Registration) {
		const id = await this.customers.register({
			...profile,
			passwordHash: await hashPassword(password),
		});
		return { id, token: await this.signIn(id) };
	}

	/**
	 * The registered customer behind these credentials, or null. Unknown
	 * e-mails and guests pay for a password check too.
	 */
	async authenticate(
		email: string,
		password: string,
	): Promise<CustomerId | null> {
		const address = Email.tryParse(email);
		const found = address
			? await this.customers.credentials({ email: address })
			: undefined;
		const matches = await verifyPassword(
			password,
			found?.passwordHash ?? (await decoyPasswordHash()),
		);
		return found?.passwordHash && matches ? found.id : null;
	}

	signIn(id: CustomerId): Promise<string> {
		return this.sessions.create(id, TenantContext.id());
	}

	/**
	 * Replaces the password and ends every session of the buyer; answers the
	 * token of a new one, or null when the current password is wrong.
	 */
	async changePassword(
		id: CustomerId,
		currentPassword: string,
		newPassword: string,
	): Promise<string | null> {
		const found = await this.customers.credentials({ id });
		if (
			!found?.passwordHash ||
			!(await verifyPassword(currentPassword, found.passwordHash))
		) {
			return null;
		}
		await this.customers.setPasswordHash(
			id,
			await hashPassword(newPassword),
		);
		await this.sessions.destroyAll(id);
		return this.signIn(id);
	}
}
