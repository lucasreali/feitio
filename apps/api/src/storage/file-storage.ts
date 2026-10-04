import type { TenantId } from "../domain/ids.js";
import type { ObjectKey } from "./object-key.js";

/** Public files are served from a permanent address; private ones only through temporary links. */
export type FileVisibility = "public" | "private";

/** Reference to a stored file. Persist both fields to reach the file later. */
export interface StoredFile {
	visibility: FileVisibility;
	key: ObjectKey;
}

export interface UploadFileInput {
	tenantId: TenantId;
	visibility: FileVisibility;
	/** Folder such as `products` or `invoices`: lowercase letters, digits and dashes. */
	category: string;
	body: Uint8Array | string;
	/**
	 * Must be one of the types the bucket accepts; it also sets the file
	 * extension. A plain string: `resolveFileType` checks and normalizes it at
	 * this single entry point, so a type would only move that check.
	 */
	contentType: string;
}

/**
 * Vendor-neutral file storage. Inject this class; never the implementation.
 * Files live at `tenants/{tenantId}/{category}/{random id}{extension}`, in the
 * public or the private bucket. Callers never choose the path.
 *
 * SOLID: one interface for public and private files. No caller uses it yet;
 * split it (interface segregation) when callers that only need public files
 * appear, not before.
 */
export abstract class FileStorage {
	abstract upload(input: UploadFileInput): Promise<StoredFile>;

	abstract remove(file: StoredFile): Promise<void>;

	/** Permanent address of a file in the public bucket. */
	abstract publicUrl(key: ObjectKey): string;

	/** Temporary address of a file in the private bucket. It always downloads the file. */
	abstract temporaryUrl(
		key: ObjectKey,
		expiresInSeconds?: number,
	): Promise<string>;

	/** Removes every file of the tenant from both buckets. */
	abstract removeTenantFiles(tenantId: TenantId): Promise<void>;
}
