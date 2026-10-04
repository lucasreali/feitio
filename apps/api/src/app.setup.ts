import fastifyCookie from "@fastify/cookie";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { SESSION_SECURITY } from "./auth/panel-scoped.decorator.js";
import { CUSTOMER_SECURITY } from "./customers/customer-scoped.decorator.js";
import { csrfHmacKey, csrfSessionBinding } from "./session/csrf.js";
import { readSessionConfig } from "./session/session.config.js";

/** Largest file accepted in a multipart upload. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Swagger UI path; its pages get their own Content-Security-Policy. */
export const DOCS_PATH = "/docs";

/**
 * Helmet's default policy without `upgrade-insecure-requests`, which makes
 * browsers fetch Swagger UI's assets over HTTPS and breaks the page when the
 * API is served over plain HTTP (local development). Only routes under
 * DOCS_PATH get it; every other route keeps the full default policy.
 */
const docsContentSecurityPolicy = {
	directives: { "upgrade-insecure-requests": null },
};

/**
 * Fastify plugins and Swagger; shared by main.ts and the e2e tests. This is
 * the app's composition root, so it knows every plugin on purpose.
 */
export async function configureApp(app: NestFastifyApplication) {
	const fastify = app.getHttpAdapter().getInstance();

	// Must run before helmet's own onRoute hook, which reads `helmet` per route.
	fastify.addHook("onRoute", (route) => {
		if (route.url.startsWith(DOCS_PATH)) {
			route.helmet = { contentSecurityPolicy: docsContentSecurityPolicy };
		}
	});
	await app.register(fastifyHelmet);
	const session = readSessionConfig();
	await app.register(fastifyCookie, { secret: session.cookieSecret });
	// CSRF secret in its own signed cookie, and tokens bound to the session
	// that asked for them. SessionGuard checks the token on data-changing
	// methods; GET /csrf-token (session required) hands tokens to the UIs.
	await app.register(fastifyCsrfProtection, {
		getUserInfo: (request) =>
			request.authSession ? csrfSessionBinding(request.authSession) : "",
		csrfOpts: { hmacKey: csrfHmacKey(session.cookieSecret) },
		cookieOpts: {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: session.secure,
			signed: true,
		},
	});
	fastify.decorateRequest("authSession", undefined);
	fastify.decorateRequest("tenant", undefined);
	fastify.decorateRequest("customerSession", undefined);
	// Larger files fail with 413 when read (throwFileSizeLimit is on by default).
	await app.register(fastifyMultipart, {
		limits: { fileSize: MAX_UPLOAD_BYTES },
	});

	const openApiConfig = new DocumentBuilder()
		.setTitle("Feitio API")
		.setVersion("1.0")
		.addCookieAuth(session.cookieName, { type: "apiKey" }, SESSION_SECURITY)
		.addBearerAuth({ type: "http", scheme: "bearer" }, CUSTOMER_SECURITY)
		.build();
	SwaggerModule.setup(
		DOCS_PATH.slice(1),
		app,
		() => SwaggerModule.createDocument(app, openApiConfig),
		{ jsonDocumentUrl: "openapi.json" },
	);
}
