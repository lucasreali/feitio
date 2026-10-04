import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersAdminController } from "./customers-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [CustomersAdminController],
	providers: [CustomersRepository],
})
export class CustomersModule {}
