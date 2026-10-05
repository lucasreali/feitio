import { randomBytes } from "node:crypto";
import { SecretBox } from "./secret-box.js";

const key = randomBytes(32).toString("base64");

describe("SecretBox", () => {
	it("opens what it sealed, and never keeps the secret in clear", () => {
		const box = new SecretBox(key);
		const sealed = box.seal("$aact_hmlg_secret-api-key");
		expect(sealed).not.toContain("secret-api-key");
		expect(box.open(sealed)).toBe("$aact_hmlg_secret-api-key");
	});

	it("seals the same secret differently each time", () => {
		const box = new SecretBox(key);
		expect(box.seal("same")).not.toBe(box.seal("same"));
	});

	it("refuses a sealed secret that was changed, or sealed with another key", () => {
		const sealed = new SecretBox(key).seal("secret");
		const [iv, tag, data] = sealed.split(".");
		const flipped = Buffer.from(data, "base64");
		flipped[0] ^= 1;
		expect(() =>
			new SecretBox(key).open(
				[iv, tag, flipped.toString("base64")].join("."),
			),
		).toThrow();
		expect(() =>
			new SecretBox(randomBytes(32).toString("base64")).open(sealed),
		).toThrow();
	});

	it("needs a key of 32 bytes", () => {
		expect(() => new SecretBox(randomBytes(16).toString("base64"))).toThrow(
			/32 bytes/,
		);
	});
});
