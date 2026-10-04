import { S3FileStorage } from "./s3-file-storage.js";

const tenantId = "0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b21";
const key = `tenants/${tenantId}/invoices/0b9f4a3e-5c1d-4e8a-9f2b-7d6c5e4a3b22.pdf`;

// Port 1 refuses connections: a test that reached the network would fail
// with a connection error instead of the validation error it expects.
const storage = (publicUrl = "https://files.example.com/public") =>
	new S3FileStorage({
		endpoint: "http://127.0.0.1:1",
		region: "us-east-1",
		accessKeyId: "key",
		secretAccessKey: "secret",
		publicBucket: "public-bucket",
		privateBucket: "private-bucket",
		publicUrl,
	});

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
