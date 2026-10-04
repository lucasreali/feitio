import { missingEnv, requireEnv } from "./env.js";

describe("env", () => {
	const saved = { ...process.env };

	afterEach(() => {
		process.env = { ...saved };
	});

	it("returns a variable that is set", () => {
		process.env.FEITIO_TEST_VALUE = "value";
		expect(requireEnv("FEITIO_TEST_VALUE")).toBe("value");
	});

	it.each([
		["missing", undefined],
		["empty", ""],
	])("fails with a clear message for a %s variable", (_case, value) => {
		delete process.env.FEITIO_TEST_VALUE;
		if (value !== undefined) {
			process.env.FEITIO_TEST_VALUE = value;
		}
		expect(() => requireEnv("FEITIO_TEST_VALUE")).toThrow(
			"FEITIO_TEST_VALUE is not set. Copy apps/api/.env.example to apps/api/.env or set it in the environment.",
		);
	});

	it("lists the missing or empty variables, in order", () => {
		process.env.FEITIO_TEST_A = "a";
		process.env.FEITIO_TEST_B = "";
		delete process.env.FEITIO_TEST_C;

		expect(
			missingEnv(["FEITIO_TEST_A", "FEITIO_TEST_B", "FEITIO_TEST_C"]),
		).toEqual(["FEITIO_TEST_B", "FEITIO_TEST_C"]);
	});
});
