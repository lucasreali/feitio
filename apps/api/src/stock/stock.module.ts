import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { StockRepository } from "./stock.repository.js";
import { StockAdminController } from "./stock-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [StockAdminController],
	providers: [StockRepository],
})
export class StockModule {}
