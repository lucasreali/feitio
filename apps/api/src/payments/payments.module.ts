import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { PaymentAccountController } from "./payment-account.controller.js";
import { PaymentGatewayModule } from "./payment-gateway.module.js";
import { Payments } from "./payments.js";
import { StorePaymentController } from "./store-payment.controller.js";

@Module({
	imports: [AuthModule, PaymentGatewayModule, TenancyModule],
	controllers: [PaymentAccountController, StorePaymentController],
	providers: [Payments],
})
export class PaymentsModule {}
