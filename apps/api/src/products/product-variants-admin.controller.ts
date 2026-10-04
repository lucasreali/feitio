import {
	Body,
	Controller,
	Delete,
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
import {
	ProductId,
	ProductOptionGroupId,
	ProductOptionId,
	ProductVariantId,
} from "../domain/ids.js";
import { NameDto } from "../http/name.dto.js";
import { nameBody, pathId } from "../http/request-body.js";
import {
	CreateOptionGroupDto,
	CreateVariantDto,
	ProductDto,
	UpdateVariantDto,
} from "./product.dto.js";
import {
	OPTION_NAME_MAX,
	parseNewOptionGroup,
	parseNewVariant,
	parseVariantChanges,
} from "./product-input.js";
import { ProductVariantsRepository } from "./product-variants.repository.js";
import { ProductsRepository } from "./products.repository.js";

/** Option groups, options and variants. Every route answers with the whole product. */
@Controller("admin")
export class ProductVariantsAdminController {
	constructor(
		private readonly variants: ProductVariantsRepository,
		private readonly products: ProductsRepository,
	) {}

	/** Adds an option group, such as Size; the existing variants take its first option. */
	@Post("products/:id/option-groups")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name or options." })
	@ApiNotFoundResponse({ description: "The store has no such product." })
	@ApiConflictResponse({
		description: "The product already has a group with this name.",
	})
	async addOptionGroup(
		@Param("id") id: string,
		@Body() body: CreateOptionGroupDto,
	): Promise<ProductDto> {
		const productId = pathId(id, ProductId);
		const group = parseNewOptionGroup(body);
		return this.product(
			(await this.variants.addOptionGroup(productId, group)) && productId,
		);
	}

	@Patch("option-groups/:id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such option group." })
	@ApiConflictResponse({
		description: "The product already has a group with this name.",
	})
	async renameOptionGroup(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<ProductDto> {
		return this.product(
			await this.variants.renameOptionGroup(
				pathId(id, ProductOptionGroupId),
				nameBody(body, OPTION_NAME_MAX),
			),
		);
	}

	/** Removes a group in which all the product's variants have the same option. */
	@Delete("option-groups/:id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such option group." })
	@ApiConflictResponse({
		description: "The product's variants differ in this group.",
	})
	async removeOptionGroup(@Param("id") id: string): Promise<ProductDto> {
		return this.product(
			await this.variants.removeOptionGroup(
				pathId(id, ProductOptionGroupId),
			),
		);
	}

	@Post("option-groups/:id/options")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such option group." })
	@ApiConflictResponse({
		description: "The group already has an option with this name.",
	})
	async addOption(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<ProductDto> {
		return this.product(
			await this.variants.addOption(
				pathId(id, ProductOptionGroupId),
				nameBody(body, OPTION_NAME_MAX),
			),
		);
	}

	@Patch("options/:id")
	@PanelScoped()
	@ApiBadRequestResponse({ description: "Invalid name." })
	@ApiNotFoundResponse({ description: "The store has no such option." })
	@ApiConflictResponse({
		description: "The group already has an option with this name.",
	})
	async renameOption(
		@Param("id") id: string,
		@Body() body: NameDto,
	): Promise<ProductDto> {
		return this.product(
			await this.variants.renameOption(
				pathId(id, ProductOptionId),
				nameBody(body, OPTION_NAME_MAX),
			),
		);
	}

	/** Removes an option no variant uses. */
	@Delete("options/:id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such option." })
	@ApiConflictResponse({ description: "A variant uses the option." })
	async removeOption(@Param("id") id: string): Promise<ProductDto> {
		return this.product(
			await this.variants.removeOption(pathId(id, ProductOptionId)),
		);
	}

	/** Adds a variant with one option of each of the product's groups. */
	@Post("products/:id/variants")
	@PanelScoped()
	@ApiBadRequestResponse({
		description:
			"Invalid variant, options that do not fit the product, or an unknown image.",
	})
	@ApiNotFoundResponse({ description: "The store has no such product." })
	@ApiConflictResponse({
		description:
			"The SKU is in use, or another variant has the same options.",
	})
	async addVariant(
		@Param("id") id: string,
		@Body() body: CreateVariantDto,
	): Promise<ProductDto> {
		const productId = pathId(id, ProductId);
		const variant = parseNewVariant(body);
		return this.product(
			(await this.variants.addVariant(productId, variant)) && productId,
		);
	}

	@Patch("variants/:id")
	@PanelScoped()
	@ApiBadRequestResponse({
		description: "Invalid changes or an unknown image.",
	})
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	@ApiConflictResponse({
		description: "The SKU is already in use in the store.",
	})
	async updateVariant(
		@Param("id") id: string,
		@Body() body: UpdateVariantDto,
	): Promise<ProductDto> {
		return this.product(
			await this.variants.updateVariant(
				pathId(id, ProductVariantId),
				parseVariantChanges(body),
			),
		);
	}

	@Delete("variants/:id")
	@PanelScoped()
	@ApiNotFoundResponse({ description: "The store has no such variant." })
	@ApiConflictResponse({ description: "It is the product's last variant." })
	async removeVariant(@Param("id") id: string): Promise<ProductDto> {
		return this.product(
			await this.variants.removeVariant(pathId(id, ProductVariantId)),
		);
	}

	private async product(
		id: ProductId | false | undefined,
	): Promise<ProductDto> {
		const product = id && (await this.products.find(id));
		if (!product) {
			throw new NotFoundException();
		}
		return product;
	}
}
