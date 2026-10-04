import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "./button";

it("renders a button styled with theme classes", () => {
	render(<Button className="w-full">Salvar</Button>);

	const button = screen.getByRole("button", { name: "Salvar" });
	expect(button.className).toContain("bg-primary");
	expect(button.className).toContain("w-full");
});
