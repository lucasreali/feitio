import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

it("renders a button styled with theme classes", () => {
	render(<Button className="w-full">Salvar</Button>);

	const button = screen.getByRole("button", { name: "Salvar" });
	expect(button.className).toContain("bg-primary");
	expect(button.className).toContain("w-full");
});

it("calls onClick when clicked", () => {
	const onClick = vi.fn();
	render(<Button onClick={onClick}>Salvar</Button>);

	fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
	expect(onClick).toHaveBeenCalledOnce();
});

it("does not react to clicks when disabled", () => {
	const onClick = vi.fn();
	render(
		<Button disabled onClick={onClick}>
			Salvar
		</Button>,
	);

	const button = screen.getByRole("button", { name: "Salvar" });
	fireEvent.click(button);
	expect(onClick).not.toHaveBeenCalled();
	expect(button).toHaveProperty("disabled", true);
});

it("applies the outline variant", () => {
	render(<Button variant="outline">Cancelar</Button>);

	const button = screen.getByRole("button", { name: "Cancelar" });
	expect(button.className).toContain("border-border");
	expect(button.className).not.toContain("bg-primary");
});
