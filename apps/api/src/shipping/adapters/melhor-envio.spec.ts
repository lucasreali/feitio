import { BadRequestException } from "@nestjs/common";
import { Cep } from "../../domain/cep.js";
import { ProductVariantId } from "../../domain/ids.js";
import { Money } from "../../domain/money.js";
import type { Parcel, ParcelItem } from "../shipping-calculator.js";
import { MelhorEnvioShipping } from "./melhor-envio.js";

const shirt = ProductVariantId.generate();
const mug = ProductVariantId.generate();
const item = (
	variantId: ProductVariantId,
	extra: Partial<ParcelItem> = {},
): ParcelItem => ({
	variantId,
	quantity: 2,
	unitPrice: Money.parse(4990),
	weight: 350,
	height: 4,
	width: 30,
	length: 25,
	...extra,
});
const parcel: Parcel = {
	destination: Cep.parse("01310100"),
	subtotal: Money.parse(9980),
	items: [item(shirt)],
};

/** A Melhor Envio that answers `body` with `status`, and the requests it got. */
function carrier(body: unknown, status = 200) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch = async (url: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	};
	const shipping = new MelhorEnvioShipping({
		url: "https://sandbox.melhorenvio.com.br",
		token: "secret-token",
		userAgent: "Feitio (tech@example.com)",
		fetch,
	});
	return { shipping, requests };
}

const config = { serviceId: 1, originCep: Cep.parse("96020360") };
const pac = {
	id: 1,
	name: "PAC",
	price: "37.79",
	custom_price: "35.70",
	delivery_time: 9,
	custom_delivery_time: 10,
	company: { id: 1, name: "Correios" },
};

describe("MelhorEnvioShipping", () => {
	it("reads the carrier's service and the CEP the parcels leave from", () => {
		const { shipping } = carrier([]);
		expect(
			shipping.parseConfig({ serviceId: 2, originCep: "96020-360" }),
		).toEqual({ serviceId: 2, originCep: "96020360" });
	});

	it.each([
		undefined,
		{ serviceId: 1 },
		{ originCep: "96020360" },
		{ serviceId: 0, originCep: "96020360" },
		{ serviceId: "1", originCep: "96020360" },
		{ serviceId: 1, originCep: "123" },
		{ serviceId: 1, originCep: "96020360", other: true },
	])("refuses %j", (input) => {
		const { shipping } = carrier([]);
		expect(() => shipping.parseConfig(input)).toThrow(BadRequestException);
	});

	it("quotes the service with the account's price and delivery time", async () => {
		const { shipping, requests } = carrier([pac, { ...pac, id: 2 }]);

		expect(await shipping.quote(config, parcel)).toEqual({
			price: 3570,
			deliveryDays: 10,
		});

		expect(requests).toHaveLength(1);
		const [{ url, init }] = requests;
		expect(url).toBe(
			"https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate",
		);
		expect(init.method).toBe("POST");
		expect(init.headers).toMatchObject({
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: "Bearer secret-token",
			"User-Agent": "Feitio (tech@example.com)",
		});
		expect(JSON.parse(String(init.body))).toEqual({
			from: { postal_code: "96020360" },
			to: { postal_code: "01310100" },
			services: "1",
			products: [
				{
					id: shirt,
					quantity: 2,
					weight: 0.35,
					height: 4,
					width: 30,
					length: 25,
					insurance_value: 49.9,
				},
			],
		});
	});

	it("takes a single service answered as an object", async () => {
		const { shipping } = carrier(pac);
		expect((await shipping.quote(config, parcel))?.price).toBe(3570);
	});

	it("cannot ship when the carrier does not serve the route", async () => {
		const { shipping } = carrier([
			{
				id: 1,
				name: "PAC",
				error: "Serviço indisponível para o trecho.",
			},
		]);
		expect(await shipping.quote(config, parcel)).toBeNull();
		expect(
			await carrier([{ ...pac, id: 2 }]).shipping.quote(config, parcel),
		).toBeNull();
	});

	it("cannot ship without a CEP or an item's weight and dimensions, and asks nothing", async () => {
		const { shipping, requests } = carrier([pac]);
		expect(
			await shipping.quote(config, { ...parcel, destination: null }),
		).toBeNull();
		expect(
			await shipping.quote(config, {
				...parcel,
				items: [item(shirt), item(mug, { length: null })],
			}),
		).toBeNull();
		expect(requests).toEqual([]);
	});

	it("fails when the carrier answers an error", async () => {
		const { shipping } = carrier({ message: "Unauthenticated." }, 401);
		await expect(shipping.quote(config, parcel)).rejects.toThrow(/401/);
	});
});
