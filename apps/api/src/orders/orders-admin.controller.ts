import {
	applyDecorators,
	Body,
	Controller,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { HttpsUrl } from "../domain/https-url.js";
import { CustomerId, OrderId } from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import {
	invalid,
	objectBody,
	optionalText,
	pathId,
	requiredText,
} from "../http/request-body.js";
import { CurrentSession } from "../session/current-session.decorator.js";
import type { Session } from "../session/session.service.js";
import {
	OrderDto,
	OrderEventDto,
	OrderEventPageDto,
	OrderNoteDto,
	OrderPageDto,
	OrderShipmentDto,
	OrderTransitionDto,
} from "./order.dto.js";
import { ORDER_STATES, type OrderState } from "./order-state.js";
import { OrdersRepository } from "./orders.repository.js";

const SEARCH_MAX = 120;
const NOTE_MAX = 2000;
const TRACKING_CODE_MAX = 60;

const pageQueries = () =>
	applyDecorators(
		ApiQuery({ name: "page", required: false, description: "From 1." }),
		ApiQuery({
			name: "pageSize",
			required: false,
			description: "1 to 100, 24 by default.",
		}),
	);

const orderState = (value: unknown, field: string): OrderState =>
	(ORDER_STATES as readonly unknown[]).includes(value)
		? (value as OrderState)
		: invalid(`${field} must be one of ${ORDER_STATES.join(", ")}`);

/** The store's orders: list, details, state changes and history. */
@Controller("admin/orders")
export class OrdersAdminController {
	constructor(private readonly orders: OrdersRepository) {}

	/** Placed orders, newest first; carts only when asked for by state. */
	@Get()
	@PanelScoped()
	@pageQueries()
	@ApiQuery({
		name: "state",
		required: false,
		enum: ORDER_STATES,
		description: "Only orders in this state; without it, all but carts.",
	})
	@ApiQuery({
		name: "customerId",
		required: false,
		description: "Only this customer's orders.",
	})
	@ApiQuery({
		name: "q",
		required: false,
		description:
			"The order's number (digits alone), or part of the buyer's e-mail.",
	})
	@ApiBadRequestResponse({
		description: "Invalid page, state, customer or search.",
	})
	async page(@Query() query: Record<string, unknown>): Promise<OrderPageDto> {
		const page = parsePage(query);
		const search =
			query.q === undefined
				? ""
				: typeof query.q === "string" && query.q.length <= SEARCH_MAX
					? query.q.trim()
					: invalid(`q must have up to ${SEARCH_MAX} characters`);
		const { items, total } = await this.orders.list(page, {
			state:
				query.state === undefined
					? undefined
					: orderState(query.state, "state"),
			customerId:
				query.customerId === undefined
					? undefined
					: (typeof query.customerId === "string" &&
							CustomerId.tryParse(query.customerId)) ||
						invalid("customerId must be a customer id"),
			search: search || undefined,
		});
		return { items, page: page.page, pageSize: page.pageSize, total };
	}

	@Get(":id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such order." })
	async get(@Param("id") id: string): Promise<OrderDto> {
		const order = await this.orders.find(pathId(id, OrderId));
		if (!order) {
			throw new NotFoundException();
		}
		return order;
	}

	/**
	 * Moves the order to another state, cancelling included. Stock follows:
	 * paid sells the reserved units, cancelling releases them, or takes the
	 * units of a paid order back.
	 */
	@Post(":id/transitions")
	@HttpCode(200)
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid state." })
	@ApiNotFoundResponse({ description: "The store has no such order." })
	@ApiConflictResponse({
		description:
			"The order cannot go from its state to this one, or there is not enough stock.",
	})
	async transition(
		@Param("id") id: string,
		@Body() body: OrderTransitionDto,
		@CurrentSession() session: Session,
	): Promise<OrderDto> {
		const orderId = pathId(id, OrderId);
		const to = orderState(objectBody(body, ["state"]).state, "state");
		const order = await this.orders.transition(orderId, to, session.userId);
		if (!order) {
			throw new NotFoundException();
		}
		return order;
	}

	/**
	 * Records the shipment of a paid order: the carrier's tracking code,
	 * which the buyer sees, and where to print the label. Replaces both.
	 */
	@Put(":id/shipment")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid tracking code or label." })
	@ApiNotFoundResponse({ description: "The store has no such order." })
	@ApiConflictResponse({
		description: "The order is not paid, or is delivered or cancelled.",
	})
	async setShipment(
		@Param("id") id: string,
		@Body() body: OrderShipmentDto,
	): Promise<OrderDto> {
		const orderId = pathId(id, OrderId);
		const fields = objectBody(body, ["trackingCode", "labelUrl"]);
		if (!("trackingCode" in fields && "labelUrl" in fields)) {
			invalid("Send both trackingCode and labelUrl; null clears one");
		}
		const order = await this.orders.setShipment(orderId, {
			trackingCode: optionalText(
				fields.trackingCode,
				"trackingCode",
				TRACKING_CODE_MAX,
			),
			labelUrl:
				fields.labelUrl === null
					? null
					: (typeof fields.labelUrl === "string" &&
							HttpsUrl.tryParse(fields.labelUrl)) ||
						invalid("labelUrl must be null or an https:// address"),
		});
		if (!order) {
			throw new NotFoundException();
		}
		return order;
	}

	/** State changes and notes, newest first. */
	@Get(":id/history")
	@PanelScoped()
	@pageQueries()
	@ApiBadRequestResponse({ description: "Invalid page." })
	@ApiNotFoundResponse({ description: "The store has no such order." })
	async history(
		@Param("id") id: string,
		@Query() query: Record<string, unknown>,
	): Promise<OrderEventPageDto> {
		const page = parsePage(query);
		const result = await this.orders.history(pathId(id, OrderId), page);
		if (!result) {
			throw new NotFoundException();
		}
		return { ...result, page: page.page, pageSize: page.pageSize };
	}

	/** Adds an internal note to the order's history; the buyer never sees it. */
	@Post(":id/notes")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid note." })
	@ApiNotFoundResponse({ description: "The store has no such order." })
	async addNote(
		@Param("id") id: string,
		@Body() body: OrderNoteDto,
		@CurrentSession() session: Session,
	): Promise<OrderEventDto> {
		const orderId = pathId(id, OrderId);
		const note = requiredText(
			objectBody(body, ["note"]).note,
			"note",
			NOTE_MAX,
		);
		const entry = await this.orders.addNote(orderId, note, session.userId);
		if (!entry) {
			throw new NotFoundException();
		}
		return entry;
	}
}
