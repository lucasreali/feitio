import { applyDecorators, NotFoundException } from "@nestjs/common";
import { ApiHeader, ApiNotFoundResponse } from "@nestjs/swagger";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { cartTokenHash } from "./cart-token.js";

/** Marks a route of the cart behind the X-Cart-Token header. */
export const CartScoped = () =>
	applyDecorators(
		TenantScoped(),
		ApiHeader({
			name: "X-Cart-Token",
			required: true,
			description: "The token answered when the cart was created.",
		}),
		ApiNotFoundResponse({ description: "No cart for this token." }),
	);

/** The hash behind the request's token; 404 without one. */
export const tokenHash = (token: string | undefined) =>
	cartTokenHash(token) ??
	(() => {
		throw new NotFoundException();
	})();
