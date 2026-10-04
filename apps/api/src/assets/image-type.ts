const startsWith = (file: Uint8Array, offset: number, signature: string) =>
	Buffer.from(file)
		.subarray(offset, offset + signature.length)
		.toString("latin1") === signature;

/** Signatures of the image types the public bucket accepts (src/storage/file-types.ts). */
const signatures: [type: string, matches: (file: Uint8Array) => boolean][] = [
	["image/jpeg", (file) => startsWith(file, 0, "\xff\xd8\xff")],
	["image/png", (file) => startsWith(file, 0, "\x89PNG\r\n\x1a\n")],
	[
		"image/webp",
		(file) => startsWith(file, 0, "RIFF") && startsWith(file, 8, "WEBP"),
	],
	[
		"image/avif",
		(file) =>
			startsWith(file, 4, "ftypavif") || startsWith(file, 4, "ftypavis"),
	],
];

/**
 * The image type a file really is, from its first bytes, or null. Uploads go
 * by this, never by the type the client declares: a declared type is only a
 * claim, and the bucket serves every tenant's files from one domain.
 */
export function detectImageType(file: Uint8Array): string | null {
	return signatures.find(([, matches]) => matches(file))?.[0] ?? null;
}
