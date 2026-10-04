import { isUuidV7, uuidv7 } from "./uuid-v7.js";

describe("uuidv7", () => {
	it("generates RFC 9562 version 7 UUIDs", () => {
		const id = uuidv7();
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(isUuidV7(id)).toBe(true);
	});

	it("starts with the creation time in milliseconds", () => {
		const id = uuidv7(Date.UTC(2026, 9, 4, 12, 0, 0));
		const millis = Number.parseInt(id.replace("-", "").slice(0, 12), 16);
		expect(millis).toBe(Date.UTC(2026, 9, 4, 12, 0, 0));
	});

	it("sorts by creation time", () => {
		const older = uuidv7(1_000);
		const newer = uuidv7(2_000);
		expect([newer, older].sort()).toEqual([older, newer]);
	});

	it("does not repeat", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
		expect(ids.size).toBe(1000);
	});
});

describe("isUuidV7", () => {
	it.each([
		["a version 4 UUID", "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21"],
		["uppercase", uuidv7().toUpperCase()],
		["a wrong variant", "019a0f2e-1234-7abc-7def-0123456789ab"],
		["garbage", "../tenant"],
	])("refuses %s", (_case, value) => {
		expect(isUuidV7(value)).toBe(false);
	});
});
