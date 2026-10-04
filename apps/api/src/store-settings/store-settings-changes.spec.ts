import { BadRequestException } from "@nestjs/common";
import { parseStoreSettingsChanges } from "./store-settings-changes.js";

describe("parseStoreSettingsChanges", () => {
	it("keeps only the fields sent, with a trimmed name", () => {
		expect(parseStoreSettingsChanges({ displayName: "  Aurora " })).toEqual(
			{
				displayName: "Aurora",
			},
		);
		expect(
			parseStoreSettingsChanges({
				logoUrl: "https://cdn.example.com/a.png",
				theme: { primary: "#C2410C", radius: "0.75rem" },
			}),
		).toEqual({
			logoUrl: "https://cdn.example.com/a.png",
			theme: { primary: "#C2410C", radius: "0.75rem" },
		});
	});

	it("removes the logo with null", () => {
		expect(parseStoreSettingsChanges({ logoUrl: null })).toEqual({
			logoUrl: null,
		});
	});

	it.each([
		["no body", undefined],
		["an array", []],
		["nothing to change", {}],
		["an unknown field", { slug: "other-store" }],
		["an empty name", { displayName: "   " }],
		["a name longer than 80 characters", { displayName: "a".repeat(81) }],
		["a number as name", { displayName: 1 }],
		["a plain HTTP logo", { logoUrl: "http://cdn.example.com/a.png" }],
		["a script as logo", { logoUrl: "javascript:alert(1)" }],
		["a theme that is not an object", { theme: "dark" }],
		["an unknown theme variable", { theme: { "font-family": "serif" } }],
		["an unsafe theme value", { theme: { primary: "red; color: blue" } }],
		["a theme value that is not text", { theme: { radius: 4 } }],
	])("refuses %s with 400", (_case, body) => {
		expect(() => parseStoreSettingsChanges(body)).toThrow(
			BadRequestException,
		);
	});
});
