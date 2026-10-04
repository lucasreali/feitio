import { applyDecorators, UseGuards, UseInterceptors } from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiHeader,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { TenantGuard } from "./tenant.guard.js";
import { TenantContextInterceptor } from "./tenant-context.interceptor.js";

/**
 * Marks a public route used by the stores and the checkout: it requires the
 * X-Tenant header and runs with that tenant in TenantContext, so
 * TenantDatabase.run sees only its rows.
 */
export const TenantScoped = () =>
	applyDecorators(
		UseGuards(TenantGuard),
		UseInterceptors(TenantContextInterceptor),
		ApiHeader({
			name: "X-Tenant",
			required: true,
			description: "Public identifier (slug) of the store's tenant.",
		}),
		ApiBadRequestResponse({ description: "Missing X-Tenant header." }),
		ApiNotFoundResponse({ description: "Unknown or inactive tenant." }),
	);
