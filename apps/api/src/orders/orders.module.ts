import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CartController } from "./cart.controller.js";
import { CartRepository } from "./cart.repository.js";

@Module({
	imports: [CustomersModule, TenancyModule],
	controllers: [CartController],
	providers: [CartRepository],
})
export class OrdersModule {}
