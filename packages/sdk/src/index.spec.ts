import { expect, it } from "vitest";
import { SDK_NAME } from "./index.js";

it("exports the package name", () => {
	expect(SDK_NAME).toBe("@feitio/sdk");
});
