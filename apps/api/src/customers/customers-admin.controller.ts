import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Patch,
	Post,
	Query,
	Res,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
	ApiQuery,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import {
	CustomerAddressId,
	CustomerGroupId,
	CustomerId,
} from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import {
	invalid,
	objectBody,
	pathId,
	requiredText,
} from "../http/request-body.js";
import { CurrentSession } from "../session/current-session.decorator.js";
import type { Session } from "../session/session.service.js";
import {
	CreateAddressDto,
	CreateCustomerDto,
	CustomerDto,
	CustomerExportDto,
	CustomerPageDto,
	UpdateAddressDto,
	UpdateCustomerDto,
} from "./customer.dto.js";
import {
	CustomerEventDto,
	CustomerEventPageDto,
	CustomerNoteDto,
} from "./customer-history.dto.js";
import {
	parseAddressChanges,
	parseCustomerChanges,
	parseNewAddress,
	parseNewCustomer,
} from "./customer-input.js";
import { CustomerSessions } from "./customer-sessions.js";
import { CustomersRepository } from "./customers.repository.js";

const SEARCH_MAX = 120;
const NOTE_MAX = 2000;

/** The store's customers and their address books. */
@Controller("admin/customers")
export class CustomersAdminController {
	constructor(
		private readonly customers: CustomersRepository,
		private readonly sessions: CustomerSessions,
	) {}

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
	@ApiQuery({
		name: "groupId",
		required: false,
		description: "Only customers in this group.",
	})
	@ApiBadRequestResponse({ description: "Invalid page, search or group." })
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
		const groupId =
			query.groupId === undefined
				? undefined
				: (typeof query.groupId === "string" &&
						CustomerGroupId.tryParse(query.groupId)) ||
					invalid("groupId must be a group id");
		const { items, total } = await this.customers.list(page, {
			search: search || undefined,
			groupId,
		});
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
	@ApiBadRequestResponse({
		description: "Invalid customer, or a group the store does not have.",
	})
	@ApiConflictResponse({
		description: "The store already has a customer with this e-mail.",
	})
	async create(
		@Body() body: CreateCustomerDto,
		@CurrentSession() session: Session,
	): Promise<CustomerDto> {
		return this.found(
			await this.customers.create(parseNewCustomer(body), session.userId),
		);
	}

	@Patch(":id")
	@PanelScoped()
	@ApiBadRequestResponse({
		description: "Invalid changes, or a group the store does not have.",
	})
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	@ApiConflictResponse({
		description: "The store already has a customer with this e-mail.",
	})
	async update(
		@Param("id") id: string,
		@Body() body: UpdateCustomerDto,
		@CurrentSession() session: Session,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const changes = parseCustomerChanges(body);
		if (
			!(await this.customers.update(customerId, changes, session.userId))
		) {
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
		@CurrentSession() session: Session,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const input = parseNewAddress(body);
		if (
			!(await this.customers.addAddress(
				customerId,
				input,
				session.userId,
			))
		) {
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
		@CurrentSession() session: Session,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		const changes = parseAddressChanges(body);
		if (
			!(await this.customers.updateAddress(
				customerId,
				pathId(addressId, CustomerAddressId),
				changes,
				session.userId,
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
		@CurrentSession() session: Session,
	): Promise<CustomerDto> {
		const customerId = pathId(id, CustomerId);
		if (
			!(await this.customers.removeAddress(
				customerId,
				pathId(addressId, CustomerAddressId),
				session.userId,
			))
		) {
			throw new NotFoundException();
		}
		return this.found(customerId);
	}

	/** Everything the store keeps about the customer, as a JSON file (LGPD access request). */
	@Get(":id/export")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	async export(
		@Param("id") id: string,
		@Res({ passthrough: true }) reply: FastifyReply,
	): Promise<CustomerExportDto> {
		const customerId = pathId(id, CustomerId);
		const data = await this.customers.export(customerId);
		if (!data) {
			throw new NotFoundException();
		}
		reply.header(
			"content-disposition",
			`attachment; filename="customer-${customerId}.json"`,
		);
		return data;
	}

	/**
	 * Erases the customer, with their addresses, groups and history, and ends
	 * their sessions in the store (LGPD deletion request). Cannot be undone.
	 */
	@Delete(":id")
	@HttpCode(204)
	@PanelScoped("owner")
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	async erase(@Param("id") id: string): Promise<void> {
		const customerId = pathId(id, CustomerId);
		if (!(await this.customers.erase(customerId))) {
			throw new NotFoundException();
		}
		await this.sessions.destroyAll(customerId);
	}

	/** What happened to the customer, newest first. */
	@Get(":id/history")
	@PanelScoped()
	@ApiQuery({ name: "page", required: false, description: "From 1." })
	@ApiQuery({
		name: "pageSize",
		required: false,
		description: "1 to 100, 24 by default.",
	})
	@ApiBadRequestResponse({ description: "Invalid page." })
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	async history(
		@Param("id") id: string,
		@Query() query: Record<string, unknown>,
	): Promise<CustomerEventPageDto> {
		const page = parsePage(query);
		const result = await this.customers.history(
			pathId(id, CustomerId),
			page,
		);
		if (!result) {
			throw new NotFoundException();
		}
		return { ...result, page: page.page, pageSize: page.pageSize };
	}

	/** Adds a note by the staff to the customer's history. */
	@Post(":id/notes")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid note." })
	@ApiNotFoundResponse({ description: "The store has no such customer." })
	async addNote(
		@Param("id") id: string,
		@Body() body: CustomerNoteDto,
		@CurrentSession() session: Session,
	): Promise<CustomerEventDto> {
		const customerId = pathId(id, CustomerId);
		const note = requiredText(
			objectBody(body, ["note"]).note,
			"note",
			NOTE_MAX,
		);
		const entry = await this.customers.addNote(
			customerId,
			note,
			session.userId,
		);
		if (!entry) {
			throw new NotFoundException();
		}
		return entry;
	}

	private async found(id: CustomerId): Promise<CustomerDto> {
		const customer = await this.customers.find(id);
		if (!customer) {
			throw new NotFoundException();
		}
		return customer;
	}
}
