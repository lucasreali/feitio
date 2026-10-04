import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
	it("verifies the password it hashed and refuses any other", async () => {
		const hash = await hashPassword("correct horse battery");

		expect(await verifyPassword("correct horse battery", hash)).toBe(true);
		expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
		expect(await verifyPassword("", hash)).toBe(false);
	});

	it("never stores the password and salts every hash", async () => {
		const first = await hashPassword("same password");
		const second = await hashPassword("same password");

		expect(first).not.toContain("same password");
		expect(first).not.toBe(second);
		expect(first).toMatch(/^scrypt\$/);
	});

	it("uses OWASP's low-memory scrypt cost (16 MiB per hash), so parallel sign-ins cannot exhaust memory", async () => {
		expect(await hashPassword("x")).toMatch(/^scrypt\$16384\$8\$5\$/);
	});

	it.each(["", "plain", "scrypt$1$2$3$x$y", "bcrypt$a$b$c$d$e"])(
		"refuses a malformed stored hash %j",
		async (stored) => {
			expect(await verifyPassword("anything", stored)).toBe(false);
		},
	);
});
