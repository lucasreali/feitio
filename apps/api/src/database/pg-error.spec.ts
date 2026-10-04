import { DrizzleQueryError } from "drizzle-orm/errors";
import pg from "pg";
import { databaseError, translateConstraints } from "./pg-error.js";

const uniqueViolation = Object.assign(new pg.DatabaseError("dup", 1, "error"), {
	code: "23505",
	constraint: "products_tenant_slug_unique",
});

describe("databaseError", () => {
	it("finds the PostgreSQL error, also inside Drizzle's wrapper", () => {
		expect(databaseError(uniqueViolation)).toBe(uniqueViolation);
		expect(
			databaseError(new DrizzleQueryError("insert", [], uniqueViolation)),
		).toBe(uniqueViolation);
	});

	it("returns undefined for other errors", () => {
		expect(databaseError(new Error("x"))).toBeUndefined();
		expect(databaseError("x")).toBeUndefined();
	});
});

describe("translateConstraints", () => {
	const map = {
		products_tenant_slug_unique: () => new Error("slug taken"),
		"23503": () => new Error("unknown id"),
	};

	it("turns a listed constraint, or else a listed code, into its error", async () => {
		await expect(
			translateConstraints(() => Promise.reject(uniqueViolation), map),
		).rejects.toThrow("slug taken");
		const foreignKey = Object.assign(
			new pg.DatabaseError("fk", 1, "error"),
			{
				code: "23503",
				constraint: "product_images_asset_fk",
			},
		);
		await expect(
			translateConstraints(() => Promise.reject(foreignKey), map),
		).rejects.toThrow("unknown id");
	});

	it("passes results and other errors through", async () => {
		await expect(translateConstraints(async () => 1, map)).resolves.toBe(1);
		const other = new Error("other");
		await expect(
			translateConstraints(() => Promise.reject(other), {}),
		).rejects.toBe(other);
	});
});
