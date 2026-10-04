import {
	type CallHandler,
	type ExecutionContext,
	Injectable,
	type NestInterceptor,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Observable } from "rxjs";
import { TenantContext } from "./tenant-context.js";

/** Runs the route handler inside TenantContext with the tenant TenantGuard resolved. */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
	intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Observable<unknown> {
		const { tenant } = context.switchToHttp().getRequest<FastifyRequest>();
		if (!tenant) {
			throw new Error(
				"TenantContextInterceptor needs TenantGuard to run first",
			);
		}
		return new Observable((subscriber) =>
			TenantContext.run(tenant, () =>
				next.handle().subscribe(subscriber),
			),
		);
	}
}
