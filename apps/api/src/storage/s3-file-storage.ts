import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	FileStorage,
	type FileVisibility,
	type StoredFile,
	type UploadFileInput,
} from "./file-storage.js";
import { resolveFileType } from "./file-types.js";
import { assertObjectKey, buildObjectKey, tenantPrefix } from "./object-key.js";

export interface S3FileStorageConfig {
	endpoint: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	publicBucket: string;
	privateBucket: string;
	/** Base address of the public bucket's files. */
	publicUrl: string;
}

const DEFAULT_TEMPORARY_URL_SECONDS = 15 * 60;

/** FileStorage for any S3-compatible service. */
export class S3FileStorage extends FileStorage {
	private readonly client: S3Client;

	constructor(private readonly config: S3FileStorageConfig) {
		super();
		this.client = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			// Path-style URLs (endpoint/bucket/key) work on every S3-compatible service.
			forcePathStyle: true,
		});
	}

	async upload(input: UploadFileInput): Promise<StoredFile> {
		const { contentType, extension } = resolveFileType(
			input.visibility,
			input.contentType,
		);
		const key = buildObjectKey(input.tenantId, input.category, extension);
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket(input.visibility),
				Key: key,
				Body: input.body,
				ContentType: contentType,
			}),
		);
		return { visibility: input.visibility, key };
	}

	async remove(file: StoredFile) {
		assertObjectKey(file.key);
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket(file.visibility),
				Key: file.key,
			}),
		);
	}

	publicUrl(key: string) {
		assertObjectKey(key);
		return `${this.config.publicUrl.replace(/\/+$/, "")}/${key}`;
	}

	async temporaryUrl(
		key: string,
		expiresInSeconds = DEFAULT_TEMPORARY_URL_SECONDS,
	) {
		assertObjectKey(key);
		return getSignedUrl(
			this.client,
			new GetObjectCommand({
				Bucket: this.config.privateBucket,
				Key: key,
				// Never render private files in the browser: documents such as XML can run scripts.
				ResponseContentDisposition: "attachment",
			}),
			{ expiresIn: expiresInSeconds },
		);
	}

	async removeTenantFiles(tenantId: string) {
		const prefix = tenantPrefix(tenantId);
		for (const bucket of [
			this.config.publicBucket,
			this.config.privateBucket,
		]) {
			let continuationToken: string | undefined;
			do {
				const page = await this.client.send(
					new ListObjectsV2Command({
						Bucket: bucket,
						Prefix: prefix,
						ContinuationToken: continuationToken,
					}),
				);
				const objects = (page.Contents ?? []).map(({ Key }) => ({
					Key,
				}));
				if (objects.length > 0) {
					const result = await this.client.send(
						new DeleteObjectsCommand({
							Bucket: bucket,
							Delete: { Objects: objects, Quiet: true },
						}),
					);
					if (result.Errors?.length) {
						const [first] = result.Errors;
						throw new Error(
							`Failed to delete ${result.Errors.length} file(s) of tenant ${tenantId} from ${bucket}: ${first.Key} (${first.Code} ${first.Message})`,
						);
					}
				}
				continuationToken = page.IsTruncated
					? page.NextContinuationToken
					: undefined;
			} while (continuationToken);
		}
	}

	private bucket(visibility: FileVisibility) {
		return visibility === "public"
			? this.config.publicBucket
			: this.config.privateBucket;
	}
}
