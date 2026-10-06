import type { CreateEmailOptions, CreateEmailRequestOptions } from "resend";
import { Email } from "../../domain/email.js";
import type { EmailMessage } from "../email-sender.js";
import { ResendEmailSender, type ResendEmails } from "./resend.js";

const message: EmailMessage = {
	to: Email.parse("ana@example.com"),
	fromName: "Loja da Ana",
	subject: "Pedido nº 7 recebido",
	html: "<p>Recebemos seu pedido.</p>",
	text: "Recebemos seu pedido.",
};

/** Resend's e-mails API, recording what it was asked to send. */
function fakeEmails(
	answer: Awaited<ReturnType<ResendEmails["send"]>> = {
		data: { id: "email_1" },
		error: null,
		headers: null,
	},
) {
	const sent: [CreateEmailOptions, CreateEmailRequestOptions | undefined][] =
		[];
	const emails: ResendEmails = {
		send: async (payload, options) => {
			sent.push([payload, options]);
			return answer;
		},
	};
	return { emails, sent };
}

const from = Email.parse("pedidos@feitio.com.br");

describe("ResendEmailSender", () => {
	it("sends from Feitio's address in the store's name, once per key", async () => {
		const { emails, sent } = fakeEmails();
		await new ResendEmailSender(emails, from).send(
			message,
			"event-1.order-email",
		);
		expect(sent).toEqual([
			[
				{
					from: '"Loja da Ana" <pedidos@feitio.com.br>',
					to: "ana@example.com",
					subject: "Pedido nº 7 recebido",
					html: "<p>Recebemos seu pedido.</p>",
					text: "Recebemos seu pedido.",
				},
				{ idempotencyKey: "event-1.order-email" },
			],
		]);
	});

	it("keeps a store name from breaking the sender's header", async () => {
		const { emails, sent } = fakeEmails();
		await new ResendEmailSender(emails, from).send(
			{ ...message, fromName: 'Loja "A"\r\nBcc: x@evil.com <x>\\' },
			"key",
		);
		expect(sent[0][0].from).toBe(
			'"Loja A Bcc: x@evil.com x" <pedidos@feitio.com.br>',
		);
	});

	it("fails when Resend refuses, so the job is retried", async () => {
		const { emails } = fakeEmails({
			data: null,
			error: {
				name: "rate_limit_exceeded",
				message: "Too many requests",
				statusCode: 429,
			},
			headers: null,
		});
		await expect(
			new ResendEmailSender(emails, from).send(message, "key"),
		).rejects.toThrow(
			"Resend refused the e-mail (429 rate_limit_exceeded): Too many requests",
		);
	});
});
