import {
	Body,
	Controller,
	Delete,
	Get,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { CustomerAddressId, CustomerId } from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import { invalid, pathId } from "../http/request-body.js";
import {
	CreateAddressDto,
	CreateCustomerDto,
	CustomerDto,
	CustomerPageDto,
	UpdateAddressDto,
	UpdateCustomerDto,
} from "./customer.dto.js";
import {
	parseAddressChanges,
	parseCustomerChanges,
	parseNewAddress,
	parseNewCustomer,
} from "./customer-input.js";
import { CustomersRepository } from "./customers.repository.js";

const SEARCH_MAX = 120;

/** The store's customers and their address books. */
@Controller("admin/customers")
export class CustomersAdminController {
	constructor(private readonly customers: CustomersRepository) {}

	/** Newest first. */
	@Get()
	@PanelScoped()
	@ApiQuery({ name: "page", required: false, description: "From 1." })
	@ApiQuery({
		name: "pageSize",
		required: false,
		description: "1 to 100, 24 by default.",
	})
	@ApiQuery({
		name: "q",
		required: false,
		description: "Part of the name or of the e-mail.",
	})
	@ApiBadRequestResponse({ description: "Invalid page or search." })
	async page(
		@Query() query: Record<string, unknown>,
	): Promise<CustomerPageDto> {
		const page = parsePage(query);
		const search =
			query.q === undefined
				? ""
				: typeof query.q === "string" && query.q.length <= SEARCH_MAX
					? query.q.trim()
					: invalid(`q must have up to ${SEARCH_MAX} characters`);
		const { items, total } = await this.customers.list(
			page,
			search || undefined,
		);
		return { items, page: page.page, pageSize: page.pageSize, total };
	}

	@Get(":id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	get(@Param("id") id: string): Promise<CustomerDto> {
		return this.found(pathId(id, CustomerId));
	}

	/** Adds a customer without an account; they can create one in the store later. */
	@Post()
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid customer." })
	@ApiConflictResponse({
		description: "The store already has a customer with this e-mail.",
	})
	async create(@Body() body: CreateCustomerDto): Promise<CustomerDto> {
		return this.found(await this.customers.create(parseNewCustomer(body)));
	}

	@Patch(":id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid changes." })
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	@ApiConflictResponse({
		description: "The store already has a customer with this e-mail.",
	})
	async update(
		@Param("id") id: string,
		@Body() body: UpdateCustomerDto,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const changes = parseCustomerChanges(body);
		if (!(await this.customers.update(customerId, changes))) {
			throw new NotFoundException();
		}
		return this.found(customerId);
	}

	@Post(":id/addresses")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid address." })
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	async addAddress(
		@Param("id") id: string,
		@Body() body: CreateAddressDto,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const input = parseNewAddress(body);
		if (!(await this.customers.addAddress(customerId, input))) {
			throw new NotFoundException();
		}
		return this.found(customerId);
	}

	@Patch(":id/addresses/:addressId")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid changes." })
	@ApiNotFoundResponse({ description: "The customer has no such address." })
	async updateAddress(
		@Param("id") id: string,
		@Param("addressId") addressId: string,
		@Body() body: UpdateAddressDto,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const changes = parseAddressChanges(body);
		if (
			!(await this.customers.updateAddress(
				customerId,
				pathId(addressId, CustomerAddressId),
				changes,
			))
		) {
			throw new NotFoundException();
		}
		return this.found(customerId);
	}

	@Delete(":id/addresses/:addressId")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The customer has no such address." })
	async removeAddress(
		@Param("id") id: string,
		@Param("addressId") addressId: string,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		if (
			!(await this.customers.removeAddress(
				customerId,
				pathId(addressId, CustomerAddressId),
			))
		) {
			throw new NotFoundException();
		}
		return this.found(customerId);
	}

	private async found(id: CustomerId): Promise<CustomerDto> {
		const customer = await this.customers.find(id);
		if (!customer) {
			throw new NotFoundException();
		}
		return customer;
	}
}
