import type { Resend } from "resend";
import type { Email } from "../../domain/email.js";
import type { EmailMessage, EmailSender } from "../email-sender.js";

/** The part of the Resend client we use. */
export type ResendEmails = Pick<Resend["emails"], "send">;

/**
 * A display name that cannot break the `From` header: no quotes, backslashes,
 * angle brackets or line breaks.
 */
const displayName = (name: string) =>
	name
		.replace(/["\\<>]/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** Sends through Resend, from Feitio's address in the store's name. */
export class ResendEmailSender implements EmailSender {
	constructor(
		private readonly emails: ResendEmails,
		private readonly from: Email,
	) {}

	async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
		const { error } = await this.emails.send(
			{
				from: `"${displayName(message.fromName)}" <${this.from}>`,
				to: message.to,
				subject: message.subject,
				html: message.html,
				text: message.text,
			},
			{ idempotencyKey },
		);
		if (error) {
			throw new Error(
				`Resend refused the e-mail (${error.statusCode} ${error.name}): ${error.message}`,
			);
		}
	}
}
