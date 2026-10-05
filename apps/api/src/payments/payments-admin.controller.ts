import {
	Body,
	Controller,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Post,
} from "@nestjs/common";
import {
	ApiBadGatewayResponse,
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { OrderId } from "../domain/ids.js";
import { pathId } from "../http/request-body.js";
import { CurrentSession } from "../session/current-session.decorator.js";
import type { Session } from "../session/session.service.js";
import { PaymentDto, RefundDto } from "./payment.dto.js";
import { parseRefund } from "./payment-input.js";
import { Payments } from "./payments.js";

/** An order's payments in the panel, and refunds. */
@Controller("admin/orders")
export class PaymentsAdminController {
	constructor(private readonly payments: Payments) {}

	/** Every payment of the order, newest first, failed ones included. */
	@Get(":id/payments")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such order." })
	async list(@Param("id") id: string): Promise<PaymentDto[]> {
		const list = await this.payments.forOrder(pathId(id, OrderId));
		if (!list) {
			throw new NotFoundException();
		}
		return list;
	}

	/**
	 * Gives money of the order's confirmed payment back to the buyer: the
	 * amount sent, or all that is left. The order's state stays: cancel it
	 * apart. Only owners.
	 */
	@Post(":id/refunds")
	@HttpCode(200)
	@PanelScoped("owner")
	@ApiBadRequestResponse({
		description: "Invalid amount, or more than is left to refund.",
	})
	@ApiNotFoundResponse({ description: "The store has no such order." })
	@ApiConflictResponse({
		description:
			"The order has no confirmed payment, or the gateway refuses the refund (its message).",
	})
	@ApiBadGatewayResponse({ description: "The gateway did not answer." })
	async refund(
		@Param("id") id: string,
		@Body() body: RefundDto,
		@CurrentSession() session: Session,
	): Promise<PaymentDto> {
		const orderId = pathId(id, OrderId);
		const payment = await this.payments.refund(
			orderId,
			parseRefund(body),
			session.userId,
		);
		if (!payment) {
			throw new NotFoundException();
		}
		return payment;
	}
}
