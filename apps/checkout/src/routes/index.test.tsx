import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Route } from "./index";

afterEach(cleanup);

it("shows the project name on the home page", () => {
	const Home = Route.options.component;
	if (!Home) {
		throw new Error("The home route has no component");
	}
	render(<Home />);

	expect(
		screen.getByRole("heading", { level: 1, name: "Feitio Checkout" }),
	).toBeDefined();
});
