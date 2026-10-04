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
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiConflictResponse,
	ApiNotFoundResponse,
} from "@nestjs/swagger";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { CustomerGroupId } from "../domain/ids.js";
import { NameDto } from "../http/name.dto.js";
import { nameBody, pathId } from "../http/request-body.js";
import { CustomerGroupDto } from "./customer-group.dto.js";
import { CustomerGroupsRepository } from "./customer-groups.repository.js";

const NAME_MAX = 80;

/** Groups of customers, for promotions and prices. Customers join them through PATCH /admin/customers/:id. */
@Controller("admin/customer-groups")
export class CustomerGroupsAdminController {
	constructor(private readonly groups: CustomerGroupsRepository) {}

	/** Every group of the store, by name. */
	@Get()
	@PanelScoped()
	list(): Promise<CustomerGroupDto[]> {
		return this.groups.list();
	}

	@Post()
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiConflictResponse({ description: "The name is already in use." })
	async create(@Body() body: NameDto): Promise<CustomerGroupDto> {
		return this.found(await this.groups.create(nameBody(body, NAME_MAX)));
	}

	@Patch(":id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such group." })
	@ApiConflictResponse({ description: "The name is already in use." })
	async rename(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<CustomerGroupDto> {
		const groupId = pathId(id, CustomerGroupId);
		if (!(await this.groups.rename(groupId, nameBody(body, NAME_MAX)))) {
			throw new NotFoundException();
		}
		return this.found(groupId);
	}

	/** Removes the group; its customers stay, out of it. */
	@Delete(":id")
	@HttpCode(204)
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such group." })
	async remove(@Param("id") id: string): Promise<void> {
		if (!(await this.groups.remove(pathId(id, CustomerGroupId)))) {
			throw new NotFoundException();
		}
	}

	private async found(id: CustomerGroupId): Promise<CustomerGroupDto> {
		const group = await this.groups.find(id);
		if (!group) {
			throw new NotFoundException();
		}
		return group;
	}
}
