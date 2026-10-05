import {
	Body,
	Controller,
	Get,
	Headers,
	NotFoundException,
	Post,
	Req,
} from "@nestjs/common";
import {
	ApiBadGatewayResponse,
	ApiBadRequestResponse,
	ApiConflictResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { CartScoped, tokenHash } from "../orders/cart-scoped.decorator.js";
import { PaymentDto, PayOrderDto } from "./payment.dto.js";
import { parsePaymentRequest } from "./payment-input.js";
import { Payments } from "./payments.js";

/** The buyer pays the placed order behind the cart token. */
@Controller("store/cart/payment")
export class StorePaymentController {
	constructor(private readonly payments: Payments) {}

	/**
	 * Charges the order's total by Pix, boleto or card. Answers what the
	 * buyer pays with: the Pix code, the boleto's line, or the card's result.
	 * A declined card is a `failed` payment, with the reason in `failure`;
	 * the buyer may pay again. A confirmed payment marks the order paid.
	 */
	@Post()
	@CartScoped()
	@ApiBadRequestResponse({
		description:
			"Invalid method or card; or no tax id (or, for a card, no phone) for the buyer.",
	})
	@ApiConflictResponse({
		description:
			"The order is not awaiting payment, already has a payment under way or done, or needs a billing address for a card; or the store does not take payments yet.",
	})
	@ApiBadGatewayResponse({
		description:
			"The gateway did not answer; the payment stays pending until it is checked.",
	})
	async pay(
		@Headers("x-cart-token") token: string | undefined,
		@Body() body: PayOrderDto,
		@Req() request: FastifyRequest,
	): Promise<PaymentDto> {
		const hash = tokenHash(token);
		const payment = await this.payments.pay(
			hash,
			parsePaymentRequest(body),
			request.ip,
		);
		if (!payment) {
			throw new NotFoundException();
		}
		return payment;
	}

	/** The order's latest payment, with what the buyer pays with. */
	@Get()
	@CartScoped()
	async latest(
		@Headers("x-cart-token") token: string | undefined,
	): Promise<PaymentDto> {
		const payment = await this.payments.latest(tokenHash(token));
		if (!payment) {
			throw new NotFoundException();
		}
		return payment;
	}
}
