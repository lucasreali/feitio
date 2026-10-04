import { resolveFileType } from "./file-types.js";

describe("resolveFileType", () => {
	it.each([
		["public", "image/jpeg", ".jpg"],
		["public", "image/png", ".png"],
		["public", "image/webp", ".webp"],
		["public", "image/avif", ".avif"],
		["private", "application/pdf", ".pdf"],
		["private", "text/csv", ".csv"],
		["private", "application/xml", ".xml"],
		["private", "text/xml", ".xml"],
	] as const)("accepts %s %s as %s", (visibility, contentType, extension) => {
		expect(resolveFileType(visibility, contentType)).toEqual({
			contentType,
			extension,
		});
	});

	it("normalizes case and drops parameters", () => {
		expect(resolveFileType("private", "Text/CSV; charset=utf-8")).toEqual({
			contentType: "text/csv",
			extension: ".csv",
		});
	});

	it.each([
		["public", "text/html"],
		["public", "image/svg+xml"],
		["public", "application/pdf"],
		["private", "image/png"],
		["private", "text/html"],
		["private", "application/octet-stream"],
		["public", ""],
		["public", "constructor"],
		["public", "__proto__"],
	] as const)("rejects %s %s", (visibility, contentType) => {
		expect(() => resolveFileType(visibility, contentType)).toThrow(
			/is not allowed/,
		);
	});
});
