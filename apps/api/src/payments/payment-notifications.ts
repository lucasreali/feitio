import { Inject, Injectable } from "@nestjs/common";
import { PaymentId } from "../domain/ids.js";
import type { DomainEvent } from "../events/domain-event.js";
import type { EventHandler } from "../events/event-handler.js";
import type { TenantTransaction } from "../tenancy/tenant-database.js";
import { PaymentAccounts } from "./payment-accounts.js";
import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-gateway.js";
import { settlePayment } from "./settle-payment.js";

/**
 * Settles a payment the gateway notified (in the worker). The notification
 * says only which charge changed: the charge is read from the gateway, so
 * notifications out of order, repeated or forged never set a status the
 * gateway does not hold.
 */
@Injectable()
export class PaymentNotifications implements EventHandler {
	readonly name = "payment-sync";
	readonly events = ["payment.notified"] as const;

	constructor(
		private readonly accounts: PaymentAccounts,
		@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
	) {}

	async handle(
		event: DomainEvent,
		{ tx }: { tx: TenantTransaction; key: string },
	): Promise<void> {
		if (event.type !== "payment.notified") {
			return;
		}
		const credential = await this.accounts.credential(tx);
		if (!credential) {
			return;
		}
		const charge = await this.gateway.find(credential, {
			id: event.gatewayId,
		});
		// A charge of no payment of ours, such as one made at the gateway's site.
		const id = charge?.reference && PaymentId.tryParse(charge.reference);
		if (charge && id) {
			await settlePayment(tx, id, charge);
		}
	}
}
