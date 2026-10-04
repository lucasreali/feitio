import {
	applyDecorators,
	createParamDecorator,
	type ExecutionContext,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiUnauthorizedResponse } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { CustomerGuard } from "./customer.guard.js";

/** Name of the buyer's token scheme in the OpenAPI document. */
export const CUSTOMER_SECURITY = "customer";

/**
 * Marks a store route of a signed-in buyer: X-Tenant, as in every store
 * route, and the token of a session in that store.
 */
export const CustomerScoped = () =>
	applyDecorators(
		TenantScoped(),
		UseGuards(CustomerGuard),
		ApiBearerAuth(CUSTOMER_SECURITY),
		ApiUnauthorizedResponse({
			description: "No valid token for this store.",
		}),
	);

/** The buyer's session, on @CustomerScoped() routes. */
export const CurrentCustomer = createParamDecorator(
	(_data: unknown, context: ExecutionContext) =>
		context.switchToHttp().getRequest<FastifyRequest>().customerSession,
);
