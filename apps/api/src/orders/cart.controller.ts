import {
	applyDecorators,
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	NotFoundException,
	Param,
	Patch,
	Post,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiHeader,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { OrderLineId } from "../domain/ids.js";
import { pathId } from "../http/request-body.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { CartRepository } from "./cart.repository.js";
import { parseLineQuantity, parseNewLine } from "./cart-input.js";
import { cartTokenHash } from "./cart-token.js";
import {
	AddLineDto,
	CartDto,
	LineQuantityDto,
	NewCartDto,
} from "./order.dto.js";

/** Marks a route of the cart behind the X-Cart-Token header. */
const CartScoped = () =>
	applyDecorators(
		TenantScoped(),
		ApiHeader({
			name: "X-Cart-Token",
			required: true,
			description: "The token answered when the cart was created.",
		}),
		ApiNotFoundResponse({ description: "No cart for this token." }),
	);

/** The hash behind the request's token; 404 without one. */
const tokenHash = (token: string | undefined) =>
	cartTokenHash(token) ??
	(() => {
		throw new NotFoundException();
	})();

/** 404 when the store has no such cart (undefined) or line (null). */
const found = (cart: CartDto | null | undefined): CartDto => {
	if (!cart) {
		throw new NotFoundException();
	}
	return cart;
};

/**
 * The buyer's cart in a store: the order before it is placed. Prices and
 * totals always come from the API, taken from the catalog on every change.
 */
@Controller("store/cart")
export class CartController {
	constructor(private readonly carts: CartRepository) {}

	/** Starts an empty cart; keep its token to change it and to follow the order. */
	@Post()
	@TenantScoped()
	create(): Promise<NewCartDto> {
		return this.carts.create();
	}

	/** The cart, or the order it became. */
	@Get()
	@CartScoped()
	async get(
		@Headers("x-cart-token") token: string | undefined,
	): Promise<CartDto> {
		return found(await this.carts.find(tokenHash(token)));
	}

	/** Adds units of a variant at the catalog's price. */
	@Post("lines")
	@CartScoped()
	@ApiBadRequestResponse({
		description:
			"Invalid line, or a variant the store does not sell (draft, archived or unknown).",
	})
	@ApiConflictResponse({
		description: "Not enough stock, or the order is no longer a cart.",
	})
	async addLine(
		@Headers("x-cart-token") token: string | undefined,
		@Body() body: AddLineDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		const { variantId, quantity } = parseNewLine(body);
		return found(await this.carts.addLine(hash, variantId, quantity));
	}

	@Patch("lines/:id")
	@CartScoped()
	@ApiBadRequestResponse({ description: "Invalid quantity." })
	@ApiConflictResponse({
		description: "Not enough stock, or the order is no longer a cart.",
	})
	async setQuantity(
		@Headers("x-cart-token") token: string | undefined,
		@Param("id") id: string,
		@Body() body: LineQuantityDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		const lineId = pathId(id, OrderLineId);
		return found(
			await this.carts.setQuantity(hash, lineId, parseLineQuantity(body)),
		);
	}

	@Delete("lines/:id")
	@CartScoped()
	@ApiConflictResponse({ description: "The order is no longer a cart." })
	async removeLine(
		@Headers("x-cart-token") token: string | undefined,
		@Param("id") id: string,
	): Promise<CartDto> {
		return found(
			await this.carts.removeLine(
				tokenHash(token),
				pathId(id, OrderLineId),
			),
		);
	}
}
