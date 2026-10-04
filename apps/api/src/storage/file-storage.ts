/** Public files are served from a permanent address; private ones only through temporary links. */
export type FileVisibility = "public" | "private";

/** Reference to a stored file. Persist both fields to reach the file later. */
export interface StoredFile {
	visibility: FileVisibility;
	key: string;
}

export interface UploadFileInput {
	tenantId: string;
	visibility: FileVisibility;
	/** Folder such as `products` or `invoices`: lowercase letters, digits and dashes. */
	category: string;
	body: Uint8Array | string;
	/** Must be one of the types the bucket accepts; it also sets the file extension. */
	contentType: string;
}

/**
 * Vendor-neutral file storage. Inject this class; never the implementation.
 * Files live at `tenants/{tenantId}/{category}/{random id}{extension}`, in the
 * public or the private bucket. Callers never choose the path.
 */
export abstract class FileStorage {
	abstract upload(input: UploadFileInput): Promise<StoredFile>;

	abstract remove(file: StoredFile): Promise<void>;

	/** Permanent address of a file in the public bucket. */
	abstract publicUrl(key: string): string;

	/** Temporary address of a file in the private bucket. It always downloads the file. */
	abstract temporaryUrl(
		key: string,
		expiresInSeconds?: number,
	): Promise<string>;

	/** Removes every file of the tenant from both buckets. */
	abstract removeTenantFiles(tenantId: string): Promise<void>;
}
