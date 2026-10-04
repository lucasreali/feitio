import { TenantId, UserId } from "./ids.js";

import { uuidv7 } from "./uuid-v7.js";

const uuid = uuidv7();
const uuidV4 = "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21";

describe.each([
	["TenantId", TenantId],
	["UserId", UserId],
])("%s", (name, Id) => {
	it("accepts a UUID v7 and keeps it as the same string", () => {
		expect(Id.parse(uuid)).toBe(uuid);
		expect(Id.tryParse(uuid)).toBe(uuid);
	});

	it.each(["", "abc", "../tenant", `${uuid} `, uuid.toUpperCase(), uuidV4])(
		"refuses %j",
		(value) => {
			expect(() => Id.parse(value)).toThrow(`Invalid ${name}`);
			expect(Id.tryParse(value)).toBeNull();
		},
	);
});

it.each([
	["TenantId", TenantId],
	["UserId", UserId],
])("%s.generate creates a valid UUID v7 id", (_name, Id) => {
	const id = Id.generate();
	expect(Id.parse(id)).toBe(id);
	expect(id[14]).toBe("7");
});

it("keeps tenant and user ids apart at compile time", () => {
	const tenantId = TenantId.parse(uuid);
	const userId = UserId.parse(uuid);
	// @ts-expect-error a tenant id is not a user id
	const wrongUser: UserId = tenantId;
	// @ts-expect-error a user id is not a tenant id
	const wrongTenant: TenantId = userId;
	// @ts-expect-error a plain string is not a tenant id
	const plain: TenantId = uuid;
	expect([wrongUser, wrongTenant, plain]).toHaveLength(3);
});
