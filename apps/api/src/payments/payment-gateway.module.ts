import { Module } from "@nestjs/common";
import { configOf } from "../config/config.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ASAAS_API, type AsaasApi, AsaasGateway } from "./adapters/asaas.js";
import { PaymentAccounts } from "./payment-accounts.js";
import { PAYMENT_GATEWAY } from "./payment-gateway.js";
import { PaymentNotifications } from "./payment-notifications.js";
import { PAYMENT_SETTINGS, type PaymentSettings } from "./payment-settings.js";
import { SecretBox } from "./secret-box.js";

/**
 * The gateway and the stores' accounts in it, for the API and the worker
 * alike, from the `asaas` and `payments` configuration.
 */
@Module({
	imports: [TenancyModule],
	providers: [
		{
			provide: ASAAS_API,
			useFactory: (): AsaasApi => ({
				...configOf("asaas"),
				fetch: globalThis.fetch,
			}),
		},
		{ provide: PAYMENT_GATEWAY, useClass: AsaasGateway },
		{
			provide: SecretBox,
			useFactory: () => new SecretBox(configOf("payments").secretKey),
		},
		{
			provide: PAYMENT_SETTINGS,
			useFactory: (): PaymentSettings => {
				const { feePercent, publicApiUrl } = configOf("payments");
				return { feePercent, publicApiUrl };
			},
		},
		PaymentAccounts,
		PaymentNotifications,
	],
	exports: [
		PAYMENT_GATEWAY,
		PAYMENT_SETTINGS,
		PaymentAccounts,
		PaymentNotifications,
	],
})
export class PaymentGatewayModule {}
