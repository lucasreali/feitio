import { Module } from "@nestjs/common";
import { Resend } from "resend";
import { configOf } from "../config/config.js";
import { ResendEmailSender } from "./adapters/resend.js";
import { EMAIL_SENDER, type EmailSender } from "./email-sender.js";
import { OrderNotifications } from "./order-notifications.js";

/** E-mail to buyers and panel users, for the worker only (the `email` configuration). */
@Module({
	providers: [
		{
			provide: EMAIL_SENDER,
			useFactory: (): EmailSender => {
				const { resendApiKey, from } = configOf("email");
				return new ResendEmailSender(
					new Resend(resendApiKey).emails,
					from,
				);
			},
		},
		OrderNotifications,
	],
	exports: [OrderNotifications],
})
export class NotificationsModule {}
