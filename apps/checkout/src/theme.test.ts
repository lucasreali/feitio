import { expect, it } from "vitest";
import { applyTheme } from "./theme";

it("overrides only the theme variables it receives", () => {
	applyTheme({ primary: "#123456", radius: "1rem" });

	const style = document.documentElement.style;
	expect(style.getPropertyValue("--primary")).toBe("#123456");
	expect(style.getPropertyValue("--radius")).toBe("1rem");
	expect(style.getPropertyValue("--background")).toBe("");
});
