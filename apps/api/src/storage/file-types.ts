import type { FileVisibility } from "./file-storage.js";

/**
 * Content types each bucket accepts, and the extension stored for each.
 * Types a browser renders as a document (HTML, SVG) are left out on purpose:
 * uploads come from tenants and every tenant's files share one domain.
 * Private files are also always downloaded, never rendered (see temporaryUrl).
 */
const allowedTypes: Record<FileVisibility, Record<string, string>> = {
	public: {
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/webp": ".webp",
		"image/avif": ".avif",
	},
	private: {
		"application/pdf": ".pdf",
		"text/csv": ".csv",
		"application/xml": ".xml",
		"text/xml": ".xml",
	},
};

/**
 * Normalizes the content type (lowercase, no parameters) and returns it with
 * its extension. Throws for any type the bucket does not accept.
 */
export function resolveFileType(
	visibility: FileVisibility,
	contentType: string,
): { contentType: string; extension: string } {
	const normalized = contentType.split(";")[0].trim().toLowerCase();
	const accepted = allowedTypes[visibility];
	if (!Object.hasOwn(accepted, normalized)) {
		throw new Error(
			`File type "${contentType}" is not allowed in the ${visibility} bucket. Allowed: ${Object.keys(accepted).join(", ")}.`,
		);
	}
	return { contentType: normalized, extension: accepted[normalized] };
}
