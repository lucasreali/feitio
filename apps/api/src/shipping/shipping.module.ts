import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { configError, missingEnv } from "../config/env.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { FixedRateShipping } from "./adapters/fixed-rate.js";
import {
	MELHOR_ENVIO_API,
	type MelhorEnvioApi,
	MelhorEnvioShipping,
} from "./adapters/melhor-envio.js";
import { StorePickupShipping } from "./adapters/store-pickup.js";
import { ShippingController } from "./shipping.controller.js";
import type { ShippingCalculators } from "./shipping-input.js";
import {
	SHIPPING_CALCULATORS,
	ShippingMethodsRepository,
} from "./shipping-methods.repository.js";
import { ShippingMethodsAdminController } from "./shipping-methods-admin.controller.js";
import { ShippingQuotes } from "./shipping-quotes.js";

const melhorEnvioEnv = [
	"MELHOR_ENVIO_URL",
	"MELHOR_ENVIO_TOKEN",
	"MELHOR_ENVIO_USER_AGENT",
] as const;

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [ShippingController, ShippingMethodsAdminController],
	providers: [
		{
			provide: MELHOR_ENVIO_API,
			useFactory: (): MelhorEnvioApi => {
				const missing = missingEnv(melhorEnvioEnv);
				if (missing.length > 0) {
					configError(
						`Missing Melhor Envio environment variables: ${missing.join(", ")}.`,
					);
				}
				const [url, token, userAgent] = melhorEnvioEnv.map(
					(name) => process.env[name] as string,
				);
				return { url, token, userAgent, fetch: globalThis.fetch };
			},
		},
		FixedRateShipping,
		MelhorEnvioShipping,
		StorePickupShipping,
		{
			// A new kind of method adds its calculator here.
			provide: SHIPPING_CALCULATORS,
			useFactory: (
				fixed: FixedRateShipping,
				melhorEnvio: MelhorEnvioShipping,
				pickup: StorePickupShipping,
			): ShippingCalculators => ({
				fixed,
				melhor_envio: melhorEnvio,
				pickup,
			}),
			inject: [
				FixedRateShipping,
				MelhorEnvioShipping,
				StorePickupShipping,
			],
		},
		ShippingMethodsRepository,
		ShippingQuotes,
	],
	exports: [ShippingQuotes],
})
export class ShippingModule {}
