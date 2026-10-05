import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CartController } from "./cart.controller.js";
import { CartRepository } from "./cart.repository.js";
import { OrdersRepository } from "./orders.repository.js";
import { OrdersAdminController } from "./orders-admin.controller.js";

@Module({
	imports: [AuthModule, CustomersModule, TenancyModule],
	controllers: [CartController, OrdersAdminController],
	providers: [CartRepository, OrdersRepository],
})
export class OrdersModule {}
