import {
	applyDecorators,
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Req,
	UnauthorizedException,
} from "@nestjs/common";
import {
	ApiBadGatewayResponse,
	ApiBadRequestResponse,
	ApiBearerAuth,
	ApiConflictResponse,
	ApiHeader,
	ApiNotFoundResponse,
	ApiQuery,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { readCustomerSession } from "../customers/customer.guard.js";
import { parseGuest, parseOrderAddress } from "../customers/customer-input.js";
import { CUSTOMER_SECURITY } from "../customers/customer-scoped.decorator.js";
import { CustomerSessions } from "../customers/customer-sessions.js";
import { Cep } from "../domain/cep.js";
import { OrderLineId, ShippingMethodId } from "../domain/ids.js";
import { invalid, objectBody, pathId } from "../http/request-body.js";
import { ShippingOptionDto } from "../shipping/shipping.dto.js";
import { ShippingQuotes } from "../shipping/shipping-quotes.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import { CartRepository } from "./cart.repository.js";
import { parseLineQuantity, parseNewLine } from "./cart-input.js";
import { cartTokenHash } from "./cart-token.js";
import {
	AddLineDto,
	CartDto,
	CartGuestDto,
	LineQuantityDto,
	NewCartDto,
	SetOrderAddressDto,
	SetShippingMethodDto,
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
	constructor(
		private readonly carts: CartRepository,
		private readonly sessions: CustomerSessions,
		private readonly quotes: ShippingQuotes,
	) {}

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

	/**
	 * Places the order: it awaits payment, with its stock reserved and its
	 * number given. Prices are taken from the catalog once more.
	 */
	@Post("place")
	@HttpCode(200)
	@CartScoped()
	@ApiConflictResponse({
		description:
			"The cart has no lines, buyer or shipping address; there is not enough stock; or it is no longer a cart.",
	})
	async place(
		@Headers("x-cart-token") token: string | undefined,
	): Promise<CartDto> {
		return found(await this.carts.place(tokenHash(token)));
	}

	/** Takes an order awaiting payment back to the cart, to change it; the stock is released. */
	@Post("reopen")
	@HttpCode(200)
	@CartScoped()
	@ApiConflictResponse({ description: "The order is not awaiting payment." })
	async reopen(
		@Headers("x-cart-token") token: string | undefined,
	): Promise<CartDto> {
		return found(await this.carts.reopen(tokenHash(token)));
	}

	/**
	 * Sets who buys. With a buyer's token (`Authorization: Bearer`), the
	 * signed-in buyer, and no body. Without one, a guest: the e-mail of a
	 * guest the store already has links to them as they are; a new e-mail
	 * adds a guest customer.
	 */
	@Put("customer")
	@CartScoped()
	@ApiBearerAuth(CUSTOMER_SECURITY)
	@ApiBadRequestResponse({ description: "Invalid guest." })
	@ApiUnauthorizedResponse({
		description: "A buyer's token that is not valid for this store.",
	})
	@ApiConflictResponse({
		description:
			"The e-mail belongs to a registered buyer, who must sign in; or the order is no longer a cart.",
	})
	async setCustomer(
		@Headers("x-cart-token") token: string | undefined,
		@Req() request: FastifyRequest,
		@Body() body: CartGuestDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		const session = await readCustomerSession(request, this.sessions);
		if (session === null) {
			throw new UnauthorizedException();
		}
		return found(
			await this.carts.setCustomer(
				hash,
				session
					? { customerId: session.customerId }
					: { guest: parseGuest(body) },
			),
		);
	}

	@Put("shipping-address")
	@CartScoped()
	@ApiBadRequestResponse({ description: "Invalid address." })
	@ApiConflictResponse({ description: "The order is no longer a cart." })
	async setShippingAddress(
		@Headers("x-cart-token") token: string | undefined,
		@Body() body: SetOrderAddressDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		return found(
			await this.carts.setAddress(
				hash,
				"shipping",
				parseOrderAddress(body),
			),
		);
	}

	@Put("billing-address")
	@CartScoped()
	@ApiBadRequestResponse({ description: "Invalid address." })
	@ApiConflictResponse({ description: "The order is no longer a cart." })
	async setBillingAddress(
		@Headers("x-cart-token") token: string | undefined,
		@Body() body: SetOrderAddressDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		return found(
			await this.carts.setAddress(
				hash,
				"billing",
				parseOrderAddress(body),
			),
		);
	}

	/**
	 * The store's shipping methods that can ship the cart, priced for it and
	 * cheapest first. To `cep` when sent, as when the buyer types a CEP before
	 * the address; otherwise to the shipping address. Without either, methods
	 * that price by CEP are left out.
	 */
	@Get("shipping-options")
	@CartScoped()
	@ApiQuery({
		name: "cep",
		required: false,
		description: "8 digits, with or without the hyphen.",
	})
	@ApiBadRequestResponse({ description: "Invalid CEP." })
	@ApiConflictResponse({ description: "The order is no longer a cart." })
	async shippingOptions(
		@Headers("x-cart-token") token: string | undefined,
		@Query() query: Record<string, unknown>,
	): Promise<ShippingOptionDto[]> {
		const hash = tokenHash(token);
		const { cep } = query;
		const destination =
			cep === undefined
				? undefined
				: (typeof cep === "string" && Cep.tryParse(cep)) ||
					invalid("cep must have 8 digits");
		const parcel = await this.carts.parcel(hash, destination);
		if (!parcel) {
			throw new NotFoundException();
		}
		return this.quotes.options(parcel);
	}

	/**
	 * Chooses how the order ships, priced into the cart's `shipping`. Quoted
	 * to the shipping address; pickup at the store needs none.
	 */
	@Put("shipping-method")
	@CartScoped()
	@ApiBadRequestResponse({
		description: "A method the store does not offer.",
	})
	@ApiConflictResponse({
		description:
			"The method cannot ship the cart (no address, or items without weight and dimensions for a carrier), the cart changed while quoting, or it is no longer a cart.",
	})
	@ApiBadGatewayResponse({ description: "The carrier did not answer." })
	async setShippingMethod(
		@Headers("x-cart-token") token: string | undefined,
		@Body() body: SetShippingMethodDto,
	): Promise<CartDto> {
		const hash = tokenHash(token);
		const { methodId } = objectBody(body, ["methodId"]);
		const id =
			(typeof methodId === "string" &&
				ShippingMethodId.tryParse(methodId)) ||
			invalid("methodId must be a shipping method id");
		const parcel = await this.carts.parcel(hash);
		if (!parcel) {
			throw new NotFoundException();
		}
		const choice = await this.quotes.quote(id, parcel);
		return found(await this.carts.setShipping(hash, parcel, choice));
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
