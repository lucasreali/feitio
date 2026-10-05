import { BadRequestException } from "@nestjs/common";
import {
	dueDate,
	parseMerchantAccount,
	parsePaymentRequest,
	parseRefund,
} from "./payment-input.js";

const address = {
	street: "Av. Paulista",
	number: "1000",
	neighborhood: "Bela Vista",
	cep: "01310-100",
};

const company = {
	name: "Loja da Ana",
	email: "Loja@Example.com",
	taxId: "11.222.333/0001-81",
	companyType: "MEI",
	phone: "(11) 98888-7777",
	monthlyIncome: 2500000,
	address,
};

const card = {
	holderName: "ANA SOUZA",
	number: "5162 3062 1937 8829",
	expiryMonth: "05",
	expiryYear: "2030",
	cvv: "318",
};

describe("parseMerchantAccount", () => {
	it("reads a company's account, in the domain's spellings", () => {
		expect(parseMerchantAccount(company)).toEqual({
			name: "Loja da Ana",
			email: "loja@example.com",
			taxId: "11222333000181",
			birthDate: null,
			companyType: "MEI",
			phone: "+5511988887777",
			monthlyIncome: 2500000,
			address: { ...address, cep: "01310100", complement: null },
		});
	});

	it("reads a person's account, with their birth date", () => {
		const { companyType: _, ...person } = company;
		expect(
			parseMerchantAccount({
				...person,
				taxId: "529.982.247-25",
				birthDate: "1990-05-16",
			}),
		).toMatchObject({
			taxId: "52998224725",
			birthDate: "1990-05-16",
			companyType: null,
		});
	});

	it.each([
		["a company without its type", { ...company, companyType: undefined }],
		["an unknown company type", { ...company, companyType: "SA" }],
		[
			"a person without a birth date",
			{ ...company, taxId: "52998224725", companyType: undefined },
		],
		[
			"an invalid birth date",
			{
				...company,
				taxId: "52998224725",
				companyType: undefined,
				birthDate: "1990-02-30",
			},
		],
		["no income", { ...company, monthlyIncome: 0 }],
		["income in reais", { ...company, monthlyIncome: 25000.5 }],
		["an invalid CEP", { ...company, address: { ...address, cep: "123" } }],
		[
			"an address without a street",
			{ ...company, address: { ...address, street: "" } },
		],
		["an unknown field", { ...company, site: "https://x" }],
	])("refuses %s", (_, body) => {
		expect(() =>
			parseMerchantAccount(JSON.parse(JSON.stringify(body))),
		).toThrow(BadRequestException);
	});
});

describe("parsePaymentRequest", () => {
	it("reads a Pix or a boleto", () => {
		expect(parsePaymentRequest({ method: "pix" })).toEqual({
			method: "pix",
			taxId: null,
			phone: null,
		});
		expect(
			parsePaymentRequest({ method: "boleto", taxId: "529.982.247-25" }),
		).toEqual({ method: "boleto", taxId: "52998224725", phone: null });
	});

	it("reads a card, digits only", () => {
		expect(
			parsePaymentRequest({ method: "card", card, phone: "11988887777" }),
		).toEqual({
			method: "card",
			taxId: null,
			phone: "+5511988887777",
			card: { ...card, number: "5162306219378829" },
		});
	});

	it.each([
		["no method", {}],
		["an unknown method", { method: "cash" }],
		["a card payment without the card", { method: "card" }],
		["a card with Pix", { method: "pix", card }],
		[
			"a short card number",
			{ method: "card", card: { ...card, number: "4111" } },
		],
		[
			"letters in the number",
			{ method: "card", card: { ...card, number: "5162a06219378829" } },
		],
		["month 13", { method: "card", card: { ...card, expiryMonth: "13" } }],
		[
			"a 2-digit year",
			{ method: "card", card: { ...card, expiryYear: "30" } },
		],
		["a 5-digit code", { method: "card", card: { ...card, cvv: "31800" } }],
		["no holder", { method: "card", card: { ...card, holderName: " " } }],
		[
			"an unknown card field",
			{ method: "card", card: { ...card, pin: "1" } },
		],
		["an invalid tax id", { method: "pix", taxId: "123" }],
	])("refuses %s", (_, body) => {
		expect(() => parsePaymentRequest(body)).toThrow(BadRequestException);
	});

	it("never puts the card's number in an error", () => {
		const number = "5162306219378829";
		try {
			parsePaymentRequest({
				method: "card",
				card: { ...card, number, expiryMonth: "13" },
			});
		} catch (error) {
			expect(
				JSON.stringify((error as BadRequestException).getResponse()),
			).not.toContain(number);
		}
	});
});

describe("parseRefund", () => {
	it("reads a part, or the rest of the payment when no amount is sent", () => {
		expect(parseRefund({ amount: 1050 })).toBe(1050);
		expect(parseRefund({})).toBeNull();
		expect(parseRefund(undefined)).toBeNull();
		expect(parseRefund(null)).toBeNull();
	});

	it.each([
		{ amount: 0 },
		{ amount: -5 },
		{ amount: 10.5 },
		{ amount: "10" },
		{ other: 1 },
	])("refuses %j", (body) => {
		expect(() => parseRefund(body)).toThrow(BadRequestException);
	});
});

describe("dueDate", () => {
	it("is the day in Brazil, plus some days", () => {
		// 02:00 UTC is still the day before in São Paulo (UTC-3).
		const now = new Date("2026-10-06T02:00:00Z");
		expect(dueDate(now, 0)).toBe("2026-10-05");
		expect(dueDate(now, 3)).toBe("2026-10-08");
		expect(dueDate(new Date("2026-12-30T15:00:00Z"), 3)).toBe("2027-01-02");
	});
});
