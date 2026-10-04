import { ThemeValue } from "./theme-value.js";

describe("ThemeValue", () => {
	it.each([
		"#1e3b32",
		"#FFF",
		"0.75rem",
		"rgb(30 59 50 / 80%)",
		"oklch(0.7 0.1 200)",
		"hsl(210, 40%, 96%)",
		"color-mix(in oklch, red 40%, white)",
		"calc(0.5rem + 2px)",
		"transparent",
	])("accepts the CSS value %j", (value) => {
		expect(ThemeValue.parse(value)).toBe(value);
		expect(ThemeValue.tryParse(value)).toBe(value);
	});

	it.each([
		["a declaration break", "red; background: url(x)"],
		["a rule break", "red } body { display: none"],
		["an external resource", "url(https://evil.example/x.png)"],
		["an unknown function", "image-set(a 1x)"],
		["an old IE expression", "expression(alert(1))"],
		["quotes", '"Comic Sans"'],
		["markup", "</style><script>"],
		["escapes", "\\72 ed"],
		["more than 64 characters", "a".repeat(65)],
		["empty", ""],
	])("refuses a value with %s", (_case, value) => {
		expect(() => ThemeValue.parse(value)).toThrow("Invalid ThemeValue");
		expect(ThemeValue.tryParse(value)).toBeNull();
	});
});
