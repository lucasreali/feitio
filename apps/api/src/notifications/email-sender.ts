import type { Email } from "../domain/email.js";

/** One e-mail to one person, already rendered. */
export interface EmailMessage {
	to: Email;
	/** Who it is from, as people see it: the store's name. */
	fromName: string;
	subject: string;
	html: string;
	/** The same message in plain text, for clients without HTML. */
	text: string;
}

/** Injection token for the `EmailSender`. */
export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

/**
 * Sends e-mail through a vendor (Resend today). Only the worker sends: every
 * e-mail goes through the queue.
 */
export interface EmailSender {
	/**
	 * Throws when the vendor does not take it, so the job is retried. The
	 * same `idempotencyKey` sends once, however many times it is called.
	 */
	send(message: EmailMessage, idempotencyKey: string): Promise<void>;
}
