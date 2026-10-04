import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	HttpException,
	HttpStatus,
	NotFoundException,
	Param,
	Patch,
	Post,
	Req,
	Res,
	UnauthorizedException,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiTooManyRequestsResponse,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { LoginAttempts } from "../auth/login-attempts.js";
import { CustomerAddressId, type CustomerId } from "../domain/ids.js";
import { pathId } from "../http/request-body.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantScoped } from "../tenancy/tenant-scoped.decorator.js";
import {
	AccountDto,
	ChangePasswordDto,
	CustomerLoginDto,
	RegisterDto,
	SignedInDto,
	TokenDto,
	UpdateAccountDto,
} from "./account.dto.js";
import { CreateAddressDto, UpdateAddressDto } from "./customer.dto.js";
import { CustomerAuth } from "./customer-auth.js";
import {
	parseAddressChanges,
	parseNewAddress,
	parsePasswordChange,
	parseProfileChanges,
	parseRegistration,
} from "./customer-input.js";
import {
	CurrentCustomer,
	CustomerScoped,
} from "./customer-scoped.decorator.js";
import type { CurrentCustomerSession } from "./customer-sessions.js";
import { CustomerSessions } from "./customer-sessions.js";
import { CustomersRepository } from "./customers.repository.js";

/** The buyer's account in a store: sign-up, sign-in, profile and address book. */
@Controller("store/account")
export class AccountController {
	constructor(
		private readonly auth: CustomerAuth,
		private readonly customers: CustomersRepository,
		private readonly sessions: CustomerSessions,
		private readonly attempts: LoginAttempts,
	) {}

	/** Creates an account in the store and signs the buyer in. */
	@Post("register")
	@TenantScoped()
	@ApiBadRequestResponse({ description: "Invalid account." })
	@ApiConflictResponse({
		description: "The store already has a customer with this e-mail.",
	})
	async register(@Body() body: RegisterDto): Promise<SignedInDto> {
		const { id, token } = await this.auth.register(parseRegistration(body));
		return { token, customer: await this.account(id) };
	}

	/**
	 * Signs a registered buyer in. Wrong credentials, unknown e-mails and
	 * guests get the same 401. Attempts are limited per store like the
	 * panel's (429 with Retry-After).
	 */
	@Post("login")
	@HttpCode(200)
	@TenantScoped()
	@ApiBadRequestResponse({ description: "E-mail or password missing." })
	@ApiUnauthorizedResponse({ description: "Invalid credentials." })
	@ApiTooManyRequestsResponse({
		description: "Too many failed attempts; see the Retry-After header.",
	})
	async login(
		@Body() body: CustomerLoginDto,
		@Req() request: FastifyRequest,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<SignedInDto> {
		const { email, password } = body ?? {};
		if (typeof email !== "string" || typeof password !== "string") {
			throw new BadRequestException("email and password are required");
		}
		const scope = `store:${TenantContext.id()}`;
		const retryAfter = await this.attempts.attempt(
			email,
			request.ip,
			scope,
		);
		if (retryAfter > 0) {
			reply.header("retry-after", String(retryAfter));
			throw new HttpException(
				"Too many sign-in attempts",
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
		const id = await this.auth.authenticate(email, password);
		if (!id) {
			throw new UnauthorizedException();
		}
		await this.attempts.succeeded(email, request.ip, scope);
		return {
			token: await this.auth.signIn(id),
			customer: await this.account(id),
		};
	}

	/** Ends the session of this token. */
	@Post("logout")
	@HttpCode(204)
	@CustomerScoped()
	async logout(
		@CurrentCustomer() session: CurrentCustomerSession,
	): Promise<void> {
		await this.sessions.destroy(session);
	}

	@Get()
	@CustomerScoped()
	get(
		@CurrentCustomer() session: CurrentCustomerSession,
	): Promise<AccountDto> {
		return this.account(session.customerId);
	}

	/** Changes the buyer's name, phone or tax id. The e-mail stays. */
	@Patch()
	@CustomerScoped()
	@ApiBadRequestResponse({ description: "Invalid changes." })
	async update(
		@CurrentCustomer() session: CurrentCustomerSession,
		@Body() body: UpdateAccountDto,
	): Promise<AccountDto> {
		await this.customers.update(
			session.customerId,
			parseProfileChanges(body),
			null,
		);
		return this.account(session.customerId);
	}

	/** Replaces the password and ends every session; use the new token. */
	@Post("password")
	@HttpCode(200)
	@CustomerScoped()
	@ApiBadRequestResponse({ description: "Invalid new password." })
	@ApiForbiddenResponse({ description: "Wrong current password." })
	async changePassword(
		@CurrentCustomer() session: CurrentCustomerSession,
		@Body() body: ChangePasswordDto,
	): Promise<TokenDto> {
		const { currentPassword, newPassword } = parsePasswordChange(body);
		const token = await this.auth.changePassword(
			session.customerId,
			currentPassword,
			newPassword,
		);
		if (!token) {
			throw new ForbiddenException("Wrong password");
		}
		return { token };
	}

	@Post("addresses")
	@CustomerScoped()
	@ApiBadRequestResponse({ description: "Invalid address." })
	async addAddress(
		@CurrentCustomer() session: CurrentCustomerSession,
		@Body() body: CreateAddressDto,
	): Promise<AccountDto> {
		await this.customers.addAddress(
			session.customerId,
			parseNewAddress(body),
			null,
		);
		return this.account(session.customerId);
	}

	@Patch("addresses/:id")
	@CustomerScoped()
	@ApiBadRequestResponse({ description: "Invalid changes." })
	@ApiNotFoundResponse({ description: "The buyer has no such address." })
	async updateAddress(
		@CurrentCustomer() session: CurrentCustomerSession,
		@Param("id") id: string,
		@Body() body: UpdateAddressDto,
	): Promise<AccountDto> {
		const changes = parseAddressChanges(body);
		if (
			!(await this.customers.updateAddress(
				session.customerId,
				pathId(id, CustomerAddressId),
				changes,
				null,
			))
		) {
			throw new NotFoundException();
		}
		return this.account(session.customerId);
	}

	@Delete("addresses/:id")
	@CustomerScoped()
	@ApiNotFoundResponse({ description: "The buyer has no such address." })
	async removeAddress(
		@CurrentCustomer() session: CurrentCustomerSession,
		@Param("id") id: string,
	): Promise<AccountDto> {
		if (
			!(await this.customers.removeAddress(
				session.customerId,
				pathId(id, CustomerAddressId),
				null,
			))
		) {
			throw new NotFoundException();
		}
		return this.account(session.customerId);
	}

	/** The buyer as the store sees them; 401 if they are gone. */
	private async account(id: CustomerId): Promise<AccountDto> {
		const customer = await this.customers.find(id);
		if (!customer) {
			throw new UnauthorizedException();
		}
		const { email, name, phone, taxId, addresses } = customer;
		return { id, email, name, phone, taxId, addresses };
	}
}
