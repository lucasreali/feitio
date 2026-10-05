import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CartController } from "./cart.controller.js";
import { CartRepository } from "./cart.repository.js";

@Module({
	imports: [TenancyModule],
	controllers: [CartController],
	providers: [CartRepository],
})
export class OrdersModule {}
