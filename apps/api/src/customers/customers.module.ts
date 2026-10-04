import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CustomerGroupsRepository } from "./customer-groups.repository.js";
import { CustomerGroupsAdminController } from "./customer-groups-admin.controller.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersAdminController } from "./customers-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [CustomersAdminController, CustomerGroupsAdminController],
	providers: [CustomersRepository, CustomerGroupsRepository],
})
export class CustomersModule {}
