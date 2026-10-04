import { beforeEach, expect, it } from "vitest";
import { applyTheme } from "./theme";

beforeEach(() => {
	document.documentElement.removeAttribute("style");
});

it("overrides only the theme variables it receives", () => {
	applyTheme({ primary: "#123456", radius: "1rem" });

	const style = document.documentElement.style;
	expect(style.getPropertyValue("--primary")).toBe("#123456");
	expect(style.getPropertyValue("--radius")).toBe("1rem");
	expect(style.getPropertyValue("--background")).toBe("");
});

it("ignores empty values instead of clearing a color already applied", () => {
	applyTheme({ primary: "#123456" });
	applyTheme({ primary: "", accent: "#b8873a" });

	const style = document.documentElement.style;
	expect(style.getPropertyValue("--primary")).toBe("#123456");
	expect(style.getPropertyValue("--accent")).toBe("#b8873a");
});

it("applies every theme variable it receives", () => {
	applyTheme({
		background: "#ffffff",
		foreground: "#000000",
		"primary-foreground": "#fafafa",
		"muted-foreground": "#666666",
		destructive: "#ff0000",
	});

	const style = document.documentElement.style;
	expect(style.getPropertyValue("--primary-foreground")).toBe("#fafafa");
	expect(style.getPropertyValue("--destructive")).toBe("#ff0000");
});
