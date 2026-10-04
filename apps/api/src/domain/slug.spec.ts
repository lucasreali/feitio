import { Slug, slugify } from "./slug.js";

describe("Slug", () => {
	it.each(["camiseta-azul", "tenis-2", "a", "a".repeat(120)])(
		"accepts %j",
		(value) => {
			expect(Slug.parse(value)).toBe(value);
		},
	);

	it.each([
		["uppercase", "Camiseta"],
		["accents", "calçado"],
		["spaces", "camiseta azul"],
		["a slash", "roupas/camisetas"],
		["double dash", "camiseta--azul"],
		["empty", ""],
		["longer than 120 characters", "a".repeat(121)],
	])("refuses %s", (_case, value) => {
		expect(() => Slug.parse(value)).toThrow("Invalid Slug");
		expect(Slug.tryParse(value)).toBeNull();
	});
});

describe("slugify", () => {
	it.each([
		["Camiseta Básica Azul", "camiseta-basica-azul"],
		["  Calçados & Acessórios!  ", "calcados-acessorios"],
		["Tênis 2.0 — Edição", "tenis-2-0-edicao"],
		["a".repeat(130), "a".repeat(120)],
	])("turns %j into %j", (name, slug) => {
		expect(slugify(name)).toBe(slug);
	});

	it("returns null when nothing usable is left", () => {
		expect(slugify("!!!")).toBeNull();
	});
});
