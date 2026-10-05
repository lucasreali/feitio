import { Module } from "@nestjs/common";
import { configError, missingEnv, requireEnv } from "../config/env.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ASAAS_API, type AsaasApi, AsaasGateway } from "./adapters/asaas.js";
import { PaymentAccounts } from "./payment-accounts.js";
import { PAYMENT_GATEWAY } from "./payment-gateway.js";
import { PAYMENT_SETTINGS, type PaymentSettings } from "./payment-settings.js";
import { SecretBox } from "./secret-box.js";

const asaasEnv = ["ASAAS_URL", "ASAAS_API_KEY", "ASAAS_WALLET_ID"] as const;

/**
 * The gateway and the stores' accounts in it, for the API and the worker
 * alike. Fails at startup without the gateway's or the payments' variables.
 */
@Module({
	imports: [TenancyModule],
	providers: [
		{
			provide: ASAAS_API,
			useFactory: (): AsaasApi => {
				const missing = missingEnv(asaasEnv);
				if (missing.length > 0) {
					configError(
						`Missing Asaas environment variables: ${missing.join(", ")}.`,
					);
				}
				const [url, apiKey, walletId] = asaasEnv.map(
					(name) => process.env[name] as string,
				);
				return { url, apiKey, walletId, fetch: globalThis.fetch };
			},
		},
		{ provide: PAYMENT_GATEWAY, useClass: AsaasGateway },
		{
			provide: SecretBox,
			useFactory: () => new SecretBox(requireEnv("PAYMENT_SECRET_KEY")),
		},
		{
			provide: PAYMENT_SETTINGS,
			useFactory: (): PaymentSettings => {
				const fee = Number(requireEnv("PAYMENT_FEE_PERCENT"));
				if (!(fee >= 0 && fee < 100)) {
					configError("PAYMENT_FEE_PERCENT must be 0 to 99.99.");
				}
				return {
					feePercent: fee,
					publicApiUrl: requireEnv("PUBLIC_API_URL").replace(
						/\/$/,
						"",
					),
				};
			},
		},
		PaymentAccounts,
	],
	exports: [
		PAYMENT_GATEWAY,
		PAYMENT_SETTINGS,
		PaymentAccounts,
	],
})
export class PaymentGatewayModule {}
