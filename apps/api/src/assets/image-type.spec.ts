import { detectImageType } from "./image-type.js";

const bytes = (...parts: (string | number[])[]) =>
	Buffer.concat(
		parts.map((part) =>
			typeof part === "string"
				? Buffer.from(part, "latin1")
				: Buffer.from(part),
		),
	);

describe("detectImageType", () => {
	it.each([
		["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0], "rest")],
		[
			"image/png",
			bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest"),
		],
		["image/webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
		["image/avif", bytes([0, 0, 0, 0x20], "ftypavif", [0, 0, 0, 0])],
		["image/avif", bytes([0, 0, 0, 0x20], "ftypavis", [0, 0, 0, 0])],
	])("recognizes %s by its first bytes", (type, file) => {
		expect(detectImageType(file)).toBe(type);
	});

	it.each([
		["HTML", bytes("<!doctype html><script>alert(1)</script>")],
		["SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')],
		["a RIFF file that is not WebP", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
		["an MP4 video", bytes([0, 0, 0, 0x20], "ftypisom", [0, 0, 0, 0])],
		["an empty file", bytes()],
		["a truncated PNG", bytes([0x89, 0x50, 0x4e])],
	])("refuses %s", (_case, file) => {
		expect(detectImageType(file)).toBeNull();
	});
});
