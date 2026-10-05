import { Inject, Injectable } from "@nestjs/common";
import { Cep } from "../../domain/cep.js";
import { Money } from "../../domain/money.js";
import { invalid } from "../../http/request-body.js";
import type {
	Parcel,
	ShippingCalculator,
	ShippingQuote,
} from "../shipping-calculator.js";
import { configFields } from "../shipping-input.js";

/** How to reach Melhor Envio: Feitio's account, from the environment. */
export interface MelhorEnvioApi {
	/** https://melhorenvio.com.br, or https://sandbox.melhorenvio.com.br for tests. */
	url: string;
	token: string;
	/** Melhor Envio asks for the application's name and a technical contact e-mail. */
	userAgent: string;
	fetch: typeof fetch;
}

export const MELHOR_ENVIO_API = Symbol("MELHOR_ENVIO_API");

export interface MelhorEnvioConfig {
	/** Melhor Envio's id of the carrier's service, such as 1 for Correios PAC. */
	serviceId: number;
	/** Where the parcels leave from. */
	originCep: Cep;
}

/** A service as Melhor Envio quotes it; `error` when it cannot ship the parcel. */
interface QuotedService {
	id: number;
	custom_price?: string;
	custom_delivery_time?: number;
	error?: string;
}

const TIMEOUT_MS = 10_000;

/**
 * One carrier service (Correios, Jadlog...) quoted through the Melhor Envio
 * aggregator, with the prices of Feitio's account.
 */
@Injectable()
export class MelhorEnvioShipping
	implements ShippingCalculator<MelhorEnvioConfig>
{
	constructor(
		@Inject(MELHOR_ENVIO_API) private readonly api: MelhorEnvioApi,
	) {}

	parseConfig(input: unknown): MelhorEnvioConfig {
		const fields = configFields(input, ["serviceId", "originCep"]);
		const serviceId = fields.serviceId;
		return {
			serviceId:
				Number.isInteger(serviceId) && (serviceId as number) > 0
					? (serviceId as number)
					: invalid(
							"config.serviceId must be a Melhor Envio service id",
						),
			originCep:
				(typeof fields.originCep === "string" &&
					Cep.tryParse(fields.originCep)) ||
				invalid("config.originCep must be a CEP"),
		};
	}

	/** null without a CEP, or when an item lacks its weight or a dimension. */
	async quote(
		config: MelhorEnvioConfig,
		parcel: Parcel,
	): Promise<ShippingQuote | null> {
		const sized = parcel.items.every(
			(item) =>
				item.weight !== null &&
				item.height !== null &&
				item.width !== null &&
				item.length !== null,
		);
		if (!parcel.destination || !sized) {
			return null;
		}
		const response = await this.api.fetch(
			`${this.api.url}/api/v2/me/shipment/calculate`,
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.api.token}`,
					"User-Agent": this.api.userAgent,
				},
				body: JSON.stringify({
					from: { postal_code: config.originCep },
					to: { postal_code: parcel.destination },
					services: String(config.serviceId),
					products: parcel.items.map((item) => ({
						id: item.variantId,
						quantity: item.quantity,
						weight: (item.weight as number) / 1000,
						height: item.height,
						width: item.width,
						length: item.length,
						insurance_value: item.unitPrice / 100,
					})),
				}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			},
		);
		if (!response.ok) {
			throw new Error(`Melhor Envio answered ${response.status}`);
		}
		// One service asked for may come as an object instead of a list.
		const services = [await response.json()].flat() as QuotedService[];
		const service = services.find((s) => s.id === config.serviceId);
		if (!service || service.error) {
			return null;
		}
		return {
			price: Money.parse(Math.round(Number(service.custom_price) * 100)),
			deliveryDays: service.custom_delivery_time ?? null,
		};
	}
}
