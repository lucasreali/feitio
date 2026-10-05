import { Body, Controller, Get, NotFoundException, Post } from "@nestjs/common";
import {
	ApiBadGatewayResponse,
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { OpenPaymentAccountDto, PaymentAccountDto } from "./payment.dto.js";
import { PaymentAccounts } from "./payment-accounts.js";
import { parseMerchantAccount } from "./payment-input.js";

/**
 * The store's account at the payment gateway, which receives its sales:
 * without it, the store takes no payments.
 */
@Controller("admin/payments/account")
export class PaymentAccountController {
	constructor(private readonly accounts: PaymentAccounts) {}

	@Get()
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no account yet." })
	async get(): Promise<PaymentAccountDto> {
		const account = await this.accounts.find();
		if (!account) {
			throw new NotFoundException();
		}
		return account;
	}

	/** Opens the store's account at the gateway, once. Only owners. */
	@Post()
	@PanelScoped("owner")
	@ApiBadRequestResponse({
		description: "Invalid data, or data the gateway refuses (its message).",
	})
	@ApiConflictResponse({ description: "The store already has an account." })
	@ApiBadGatewayResponse({ description: "The gateway did not answer." })
	open(@Body() body: OpenPaymentAccountDto): Promise<PaymentAccountDto> {
		return this.accounts.open(parseMerchantAccount(body));
	}
}
