import { parseCreateStoreArgs } from "./create-store-args.js";

const valid = [
	"--slug",
	"loja-aurora",
	"--name",
	"Aurora Ateliê",
	"--owner-email",
	"Ana@Aurora.com.br",
	"--owner-name",
	"Ana Souza",
	"--owner-cpf",
	"529.982.247-25",
];

describe("parseCreateStoreArgs", () => {
	it("reads the store and its owner into domain types", () => {
		expect(parseCreateStoreArgs(valid)).toEqual({
			slug: "loja-aurora",
			name: "Aurora Ateliê",
			owner: {
				email: "ana@aurora.com.br",
				name: "Ana Souza",
				cpf: "52998224725",
			},
		});
	});

	it("leaves the owner's name and CPF out when not given, for an existing user", () => {
		expect(parseCreateStoreArgs(valid.slice(0, 6))).toEqual({
			slug: "loja-aurora",
			name: "Aurora Ateliê",
			owner: { email: "ana@aurora.com.br" },
		});
	});

	it.each([
		["a missing slug", ["--name", "A", "--owner-email", "a@b.com"]],
		["an invalid slug", ["--slug", "Loja Aurora", ...valid.slice(2)]],
		["a missing name", [...valid.slice(0, 2), ...valid.slice(4)]],
		["an invalid e-mail", [...valid.slice(0, 5), "ana", ...valid.slice(6)]],
		["an invalid CPF", [...valid.slice(0, 11), "111.111.111-11"]],
		["a CPF without a name", [...valid.slice(0, 6), ...valid.slice(8)]],
		["an unknown option", [...valid, "--plan", "pro"]],
	])("refuses %s", (_case, argv) => {
		expect(() => parseCreateStoreArgs(argv)).toThrow();
	});
});
