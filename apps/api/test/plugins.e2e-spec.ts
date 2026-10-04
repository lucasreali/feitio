import { Controller, Module, Post, Req } from "@nestjs/common";
import {
	FastifyAdapter,
	type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyRequest } from "fastify";
import { AppModule } from "../src/app.module.js";
import { configureApp, MAX_UPLOAD_BYTES } from "../src/app.setup.js";

/** Test-only routes; the API itself has no upload route yet. */
@Controller("test-plugins")
class TestPluginsController {
	/** Shaped like a future webhook: public, no session, data-changing. */
	@Post("webhook")
	webhook() {
		return { received: true };
	}

	@Post("upload")
	async upload(@Req() request: FastifyRequest) {
		const file = await request.file();
		return { size: (await file?.toBuffer())?.length ?? 0 };
	}
}

@Module({ imports: [AppModule], controllers: [TestPluginsController] })
class TestPluginsModule {}

/** A multipart/form-data body with one file field. */
function multipartFile(size: number) {
	const boundary = `----feitio${crypto.randomUUID()}`;
	const payload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
		),
		Buffer.alloc(size, 1),
		Buffer.from(`\r\n--${boundary}--\r\n`),
	]);
	return {
		payload,
		headers: {
			"content-type": `multipart/form-data; boundary=${boundary}`,
		},
	};
}

describe("Fastify plugins (e2e)", () => {
	let app: NestFastifyApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [TestPluginsModule],
		}).compile();
		app = moduleRef.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		await configureApp(app);
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
	});

	afterAll(() => app.close());

	describe("multipart uploads", () => {
		it("accept a file up to the limit", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/test-plugins/upload",
				...multipartFile(1024),
			});
			expect(response.statusCode).toBe(201);
			expect(response.json()).toEqual({ size: 1024 });
		});

		it("refuse a file over 5 MB", async () => {
			const response = await app.inject({
				method: "POST",
				url: "/test-plugins/upload",
				...multipartFile(MAX_UPLOAD_BYTES + 1),
			});
			expect(response.statusCode).toBe(413);
		});
	});

	describe("routes exempt from CSRF", () => {
		it("work without a CSRF token", async () => {
			const health = await app.inject({ method: "GET", url: "/health" });
			expect(health.statusCode).toBe(200);

			const webhook = await app.inject({
				method: "POST",
				url: "/test-plugins/webhook",
				payload: { event: "payment.confirmed" },
			});
			expect(webhook.statusCode).toBe(201);
			expect(webhook.json()).toEqual({ received: true });

			const docs = await app.inject({ method: "GET", url: "/docs" });
			expect(docs.statusCode).toBe(200);
		});
	});

	describe("CSRF token", () => {
		it("is only issued to a valid session", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/csrf-token",
			});
			expect(response.statusCode).toBe(401);
		});
	});

	describe("security headers", () => {
		it("are sent on API responses, with the full default policy", async () => {
			const response = await app.inject({
				method: "GET",
				url: "/health",
			});

			expect(response.statusCode).toBe(200);
			expect(response.headers).toMatchObject({
				"x-content-type-options": "nosniff",
				"x-frame-options": "SAMEORIGIN",
				"strict-transport-security":
					expect.stringContaining("max-age="),
			});
			const csp = String(response.headers["content-security-policy"]);
			expect(csp).toContain("default-src 'self'");
			expect(csp).toContain("script-src 'self'");
			expect(csp).toContain("upgrade-insecure-requests");
		});

		it("keep the Swagger UI working, relaxing only its own policy", async () => {
			const page = await app.inject({ method: "GET", url: "/docs" });
			expect(page.statusCode).toBe(200);
			expect(page.headers["content-type"]).toContain("text/html");
			const csp = String(page.headers["content-security-policy"]);
			expect(csp).toContain("script-src 'self'");
			expect(csp).not.toContain("upgrade-insecure-requests");

			const assets =
				page.body.match(/(?<=src=")\.\/docs\/[^"]+\.js/g) ?? [];
			expect(assets.length).toBeGreaterThan(0);
			for (const asset of assets) {
				const response = await app.inject({
					method: "GET",
					url: asset.replace(/^\./, ""),
				});
				expect(response.statusCode, asset).toBe(200);
			}

			const spec = await app.inject({
				method: "GET",
				url: "/openapi.json",
			});
			expect(spec.statusCode).toBe(200);
			expect(spec.json()).toHaveProperty("openapi");
		});
	});
});
