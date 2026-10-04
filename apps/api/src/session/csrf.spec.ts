import type { FastifyRequest } from "fastify";
import { changesData } from "./csrf.js";

const request = (method: string) => ({ method }) as FastifyRequest;

describe("changesData", () => {
	it.each(["GET", "HEAD", "OPTIONS"])(
		"does not ask %s for a CSRF token",
		(method) => {
			expect(changesData(request(method))).toBe(false);
		},
	);

	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"asks %s for a CSRF token",
		(method) => {
			expect(changesData(request(method))).toBe(true);
		},
	);
});
