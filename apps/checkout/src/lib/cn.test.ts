import { expect, it } from "vitest";
import { cn } from "./cn";

it("joins conditional classes", () => {
	expect(cn("p-4", false && "hidden", undefined, ["font-medium"])).toBe(
		"p-4 font-medium",
	);
});

it("lets the last conflicting Tailwind class win, theme colors included", () => {
	expect(cn("bg-primary px-4", "bg-muted px-2")).toBe("bg-muted px-2");
	expect(cn("text-foreground", "text-sm")).toBe("text-foreground text-sm");
});
