import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { AccountController } from "./account.controller.js";
import { CustomerGuard } from "./customer.guard.js";
import { CustomerAuth } from "./customer-auth.js";
import { CustomerGroupsRepository } from "./customer-groups.repository.js";
import { CustomerGroupsAdminController } from "./customer-groups-admin.controller.js";
import { CustomerSessions } from "./customer-sessions.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersAdminController } from "./customers-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule, ValkeyModule],
	controllers: [
		CustomersAdminController,
		CustomerGroupsAdminController,
		AccountController,
	],
	providers: [
		CustomersRepository,
		CustomerGroupsRepository,
		CustomerAuth,
		CustomerSessions,
		CustomerGuard,
	],
})
export class CustomersModule {}
