import { HttpsUrl } from "./https-url.js";

describe("HttpsUrl", () => {
	it.each([
		"https://cdn.example.com/logo.png",
		"https://placehold.co/160x48?text=Aurora",
	])("accepts %j", (value) => {
		expect(HttpsUrl.parse(value)).toBe(value);
		expect(HttpsUrl.tryParse(value)).toBe(value);
	});

	it.each([
		["plain HTTP", "http://cdn.example.com/logo.png"],
		["a script", "javascript:alert(1)"],
		["a data URL", "data:image/png;base64,AAAA"],
		["credentials", "https://user:pass@cdn.example.com/logo.png"],
		["no scheme", "cdn.example.com/logo.png"],
		["spaces around it", " https://cdn.example.com/logo.png"],
		["more than 2048 characters", `https://x.com/${"a".repeat(2040)}`],
		["empty", ""],
	])("refuses a URL with %s", (_case, value) => {
		expect(() => HttpsUrl.parse(value)).toThrow("Invalid HttpsUrl");
		expect(HttpsUrl.tryParse(value)).toBeNull();
	});
});
