import {
	DeleteObjectsCommand,
	ListObjectsV2Command,
	type S3Client,
} from "@aws-sdk/client-s3";
import { createS3Client, S3FileStorage } from "./s3-file-storage.js";

const tenantId = "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21";
const key = `tenants/${tenantId}/invoices/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b22.pdf`;

// Port 1 refuses connections: a test that reached the network would fail
// with a connection error instead of the validation error it expects.
const configWith = (publicUrl = "https://files.example.com/public") => ({
	endpoint: "http://127.0.0.1:1",
	region: "us-east-1",
	accessKeyId: "key",
	secretAccessKey: "secret",
	publicBucket: "public-bucket",
	privateBucket: "private-bucket",
	publicUrl,
});
const storage = (publicUrl?: string) => {
	const config = configWith(publicUrl);
	return new S3FileStorage(config, createS3Client(config));
};

describe("S3FileStorage (no network)", () => {
	it("refuses a disallowed type before uploading anything", async () => {
		await expect(
			storage().upload({
				tenantId,
				visibility: "public",
				category: "products",
				body: "<script>",
				contentType: "text/html",
			}),
		).rejects.toThrow(/is not allowed in the public bucket/);
	});

	it.each([
		[
			"remove",
			(s: S3FileStorage) =>
				s.remove({ visibility: "public", key: "../x.png" }),
		],
		[
			"publicUrl",
			async (s: S3FileStorage) => s.publicUrl("tenants/x/products/a.png"),
		],
		[
			"temporaryUrl",
			(s: S3FileStorage) => s.temporaryUrl("other/path.pdf"),
		],
		[
			"removeTenantFiles",
			(s: S3FileStorage) => s.removeTenantFiles("../other"),
		],
	])(
		"%s refuses keys and tenant ids it did not build",
		async (_name, call) => {
			await expect(call(storage())).rejects.toThrow(/Invalid/);
		},
	);

	it("builds public URLs from the base address, ignoring trailing slashes", () => {
		expect(
			storage("https://files.example.com/public//").publicUrl(
				key.replace(".pdf", ".png"),
			),
		).toBe(
			`https://files.example.com/public/${key.replace(".pdf", ".png")}`,
		);
	});

	it("signs temporary links to the private bucket that force download", async () => {
		const url = new URL(await storage().temporaryUrl(key));

		expect(url.pathname).toBe(`/private-bucket/${key}`);
		expect(url.searchParams.get("response-content-disposition")).toBe(
			"attachment",
		);
		expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
		expect(url.searchParams.get("X-Amz-Signature")).toMatch(
			/^[0-9a-f]{64}$/,
		);
	});

	it("lets the caller choose how long a temporary link lasts", async () => {
		const url = new URL(await storage().temporaryUrl(key, 60));
		expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
	});
});

describe("S3FileStorage.removeTenantFiles", () => {
	const prefix = `tenants/${tenantId}/`;
	const objects = (...names: string[]) =>
		names.map((name) => ({ Key: `${prefix}products/${name}` }));

	/** A fake S3 client: list pages per bucket, and answers for each delete. */
	const fakeClient = (
		pages: Record<string, { Contents: { Key: string }[]; next?: string }[]>,
		deleteErrors: { Key: string; Code: string; Message: string }[] = [],
	) => {
		const deleted: Record<string, string[]> = {};
		const prefixes: string[] = [];
		const send = async (command: unknown) => {
			if (command instanceof ListObjectsV2Command) {
				const { Bucket, Prefix, ContinuationToken } = command.input;
				prefixes.push(String(Prefix));
				const bucketPages = pages[String(Bucket)] ?? [{ Contents: [] }];
				const index = ContinuationToken ? Number(ContinuationToken) : 0;
				const page = bucketPages[index];
				const hasNext = index + 1 < bucketPages.length;
				return {
					Contents: page.Contents,
					IsTruncated: hasNext,
					NextContinuationToken: hasNext
						? String(index + 1)
						: undefined,
				};
			}
			if (command instanceof DeleteObjectsCommand) {
				const { Bucket, Delete } = command.input;
				deleted[String(Bucket)] = [
					...(deleted[String(Bucket)] ?? []),
					...(Delete?.Objects ?? []).map((o) => String(o.Key)),
				];
				return { Errors: deleteErrors };
			}
			throw new Error("unexpected command");
		};
		return { client: { send } as unknown as S3Client, deleted, prefixes };
	};

	it("deletes every page of the tenant's files from both buckets", async () => {
		const { client, deleted, prefixes } = fakeClient({
			"public-bucket": [
				{ Contents: objects("a.png", "b.png") },
				{ Contents: objects("c.png") },
			],
			"private-bucket": [{ Contents: objects("d.pdf") }],
		});

		await new S3FileStorage(configWith(), client).removeTenantFiles(
			tenantId,
		);

		expect(deleted).toEqual({
			"public-bucket": objects("a.png", "b.png", "c.png").map(
				(o) => o.Key,
			),
			"private-bucket": objects("d.pdf").map((o) => o.Key),
		});
		expect(new Set(prefixes)).toEqual(new Set([prefix]));
	});

	it("fails, naming a file, when the service refuses to delete it", async () => {
		const { client } = fakeClient(
			{ "public-bucket": [{ Contents: objects("a.png") }] },
			[
				{
					Key: `${prefix}products/a.png`,
					Code: "AccessDenied",
					Message: "no",
				},
			],
		);

		await expect(
			new S3FileStorage(configWith(), client).removeTenantFiles(tenantId),
		).rejects.toThrow(
			`Failed to delete 1 file(s) of tenant ${tenantId} from public-bucket: ${prefix}products/a.png (AccessDenied no)`,
		);
	});
});
