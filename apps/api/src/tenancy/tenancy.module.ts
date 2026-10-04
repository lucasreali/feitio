import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { TenantGuard } from "./tenant.guard.js";
import { TenantContextInterceptor } from "./tenant-context.interceptor.js";
import { TenantDatabase } from "./tenant-database.js";
import { TenantResolver } from "./tenant-resolver.js";

@Module({
	imports: [DatabaseModule],
	providers: [
		TenantDatabase,
		TenantResolver,
		TenantGuard,
		TenantContextInterceptor,
	],
	exports: [
		TenantDatabase,
		TenantResolver,
		TenantGuard,
		TenantContextInterceptor,
	],
})
export class TenancyModule {}
