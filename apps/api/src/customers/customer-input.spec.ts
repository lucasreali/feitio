import { BadRequestException } from "@nestjs/common";
import {
	parseAddressChanges,
	parseCustomerChanges,
	parseNewAddress,
	parseNewCustomer,
	parsePasswordChange,
	parseProfileChanges,
	parseRegistration,
} from "./customer-input.js";

const address = {
	recipient: " Ana Souza ",
	phone: "(11) 98765-4321",
	cep: "01310-100",
	street: "Av. Paulista",
	number: "1000",
	complement: " ap. 12 ",
	neighborhood: "Bela Vista",
	city: "São Paulo",
	state: "sp",
};

describe("parseNewCustomer", () => {
	it("takes the e-mail and the name, with optional phone and tax id", () => {
		expect(
			parseNewCustomer({ email: " Ana@Example.com ", name: " Ana " }),
		).toEqual({
			email: "ana@example.com",
			name: "Ana",
			phone: null,
			taxId: null,
			groupIds: [],
		});
		expect(
			parseNewCustomer({
				email: "ana@example.com",
				name: "Ana",
				phone: "(11) 98765-4321",
				taxId: "11.222.333/0001-81",
			}),
		).toEqual({
			email: "ana@example.com",
			name: "Ana",
			phone: "+5511987654321",
			taxId: "11222333000181",
			groupIds: [],
		});
	});

	it("takes the groups, by id", () => {
		const group = "0199d5a4-0000-7000-8000-000000000000";
		expect(
			parseNewCustomer({
				email: "ana@example.com",
				name: "Ana",
				groupIds: [group],
			}).groupIds,
		).toEqual([group]);
	});

	it.each([
		["no e-mail", { name: "Ana" }],
		["no name", { email: "ana@example.com" }],
		["an invalid e-mail", { email: "ana", name: "Ana" }],
		[
			"an invalid phone",
			{ email: "ana@example.com", name: "Ana", phone: "123" },
		],
		[
			"an invalid tax id",
			{ email: "ana@example.com", name: "Ana", taxId: "52998224726" },
		],
		[
			"a password",
			{ email: "ana@example.com", name: "Ana", password: "secret" },
		],
	])("refuses %s", (_case, body) => {
		expect(() => parseNewCustomer(body)).toThrow(BadRequestException);
	});
});

describe("parseCustomerChanges", () => {
	it("reads only the fields sent, and clears phone and tax id with null", () => {
		expect(parseCustomerChanges({ name: "Ana Souza" })).toEqual({
			name: "Ana Souza",
		});
		expect(parseCustomerChanges({ phone: null, taxId: null })).toEqual({
			phone: null,
			taxId: null,
		});
	});

	it.each([
		["no field", {}],
		["a blank name", { name: " " }],
		["a null e-mail", { email: null }],
		["groups that are not ids", { groupIds: ["vip"] }],
		[
			"repeated groups",
			{
				groupIds: [
					"0199d5a4-0000-7000-8000-000000000000",
					"0199d5a4-0000-7000-8000-000000000000",
				],
			},
		],
	])("refuses %s", (_case, body) => {
		expect(() => parseCustomerChanges(body)).toThrow(BadRequestException);
	});
});

describe("parseNewAddress", () => {
	it("reads a Brazilian address in its stored formats", () => {
		expect(parseNewAddress(address)).toEqual({
			recipient: "Ana Souza",
			phone: "+5511987654321",
			cep: "01310100",
			street: "Av. Paulista",
			number: "1000",
			complement: "ap. 12",
			neighborhood: "Bela Vista",
			city: "São Paulo",
			state: "SP",
			defaultShipping: false,
			defaultBilling: false,
		});
	});

	it("makes phone and complement optional, and takes the defaults", () => {
		const { phone: _, complement: __, ...required } = address;
		expect(
			parseNewAddress({ ...required, defaultShipping: true }),
		).toMatchObject({
			phone: null,
			complement: null,
			defaultShipping: true,
			defaultBilling: false,
		});
	});

	it.each([
		["no CEP", { ...address, cep: undefined }],
		["a CEP of 7 digits", { ...address, cep: "0131010" }],
		["an unknown state", { ...address, state: "XX" }],
		["a blank street", { ...address, street: " " }],
		["defaultShipping as text", { ...address, defaultShipping: "true" }],
		["an unknown field", { ...address, country: "BR" }],
	])("refuses %s", (_case, body) => {
		expect(() => parseNewAddress(body)).toThrow(BadRequestException);
	});
});

describe("parseAddressChanges", () => {
	it("reads only the fields sent", () => {
		expect(
			parseAddressChanges({ number: "1001", defaultBilling: true }),
		).toEqual({ number: "1001", defaultBilling: true });
		expect(parseAddressChanges({ complement: null })).toEqual({
			complement: null,
		});
	});

	it.each([
		["no field", {}],
		["a null CEP", { cep: null }],
	])("refuses %s", (_case, body) => {
		expect(() => parseAddressChanges(body)).toThrow(BadRequestException);
	});
});

describe("parseRegistration", () => {
	it("takes the e-mail, the password and the profile", () => {
		expect(
			parseRegistration({
				email: "Ana@Example.com",
				password: "  long enough  ",
				name: "Ana",
				phone: "11987654321",
			}),
		).toEqual({
			email: "ana@example.com",
			password: "  long enough  ",
			name: "Ana",
			phone: "+5511987654321",
			taxId: null,
		});
	});

	it.each([
		["no password", { email: "ana@example.com", name: "Ana" }],
		[
			"a password of 7 characters",
			{ email: "ana@example.com", name: "Ana", password: "1234567" },
		],
		[
			"a password of 129 characters",
			{
				email: "ana@example.com",
				name: "Ana",
				password: "x".repeat(129),
			},
		],
		[
			"groups",
			{
				email: "ana@example.com",
				name: "Ana",
				password: "12345678",
				groupIds: [],
			},
		],
	])("refuses %s", (_case, body) => {
		expect(() => parseRegistration(body)).toThrow(BadRequestException);
	});
});

describe("parseProfileChanges", () => {
	it("reads the name, the phone and the tax id", () => {
		expect(parseProfileChanges({ name: "Ana", taxId: null })).toEqual({
			name: "Ana",
			taxId: null,
		});
	});

	it.each([
		["the e-mail", { email: "ana@example.com" }],
		["groups", { groupIds: [] }],
	])("refuses %s", (_case, body) => {
		expect(() => parseProfileChanges(body)).toThrow(BadRequestException);
	});
});

describe("parsePasswordChange", () => {
	it("takes the current and the new password", () => {
		expect(
			parsePasswordChange({
				currentPassword: "old",
				newPassword: "new password",
			}),
		).toEqual({ currentPassword: "old", newPassword: "new password" });
	});

	it.each([
		["no current password", { newPassword: "new password" }],
		[
			"a short new password",
			{ currentPassword: "old", newPassword: "short" },
		],
	])("refuses %s", (_case, body) => {
		expect(() => parsePasswordChange(body)).toThrow(BadRequestException);
	});
});
