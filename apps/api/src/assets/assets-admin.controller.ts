import {
	BadRequestException,
	Controller,
	Delete,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Post,
	Query,
	Req,
	UnsupportedMediaTypeException,
} from "@nestjs/common";
import {
	ApiBadRequestResponse,
	ApiBody,
	ApiConsumes,
	ApiNoContentResponse,
	ApiNotFoundResponse,
	ApiPayloadTooLargeResponse,
	ApiQuery,
	ApiUnsupportedMediaTypeResponse,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { PanelScoped } from "../auth/panel-scoped.decorator.js";
import { AssetId } from "../domain/ids.js";
import { parsePage } from "../http/page.js";
import { AssetDto, AssetPageDto } from "./asset.dto.js";
import { AssetsService } from "./assets.service.js";
import { detectImageType } from "./image-type.js";

@Controller("admin/assets")
export class AssetsAdminController {
	constructor(private readonly assets: AssetsService) {}

	/** The store's images, newest first, to pick for products and variants. */
	@Get()
	@PanelScoped()
	@ApiQuery({ name: "page", required: false, description: "From 1." })
	@ApiQuery({
		name: "pageSize",
		required: false,
		description: "1 to 100, 24 by default.",
	})
	@ApiBadRequestResponse({ description: "Invalid page." })
	async list(@Query() query: Record<string, unknown>): Promise<AssetPageDto> {
		const page = parsePage(query);
		const { items, total } = await this.assets.list(page);
		return { items, page: page.page, pageSize: page.pageSize, total };
	}

	/** Uploads a catalog image (JPEG, PNG, WebP or AVIF, up to 5 MB) in the `file` field. */
	@Post()
	@PanelScoped()
	@ApiConsumes("multipart/form-data")
	@ApiBody({
		schema: {
			type: "object",
			required: ["file"],
			properties: { file: { type: "string", format: "binary" } },
		},
	})
	@ApiBadRequestResponse({ description: "No file in the `file` field." })
	@ApiPayloadTooLargeResponse({ description: "The file is over 5 MB." })
	@ApiUnsupportedMediaTypeResponse({
		description: "The file is not a JPEG, PNG, WebP or AVIF image.",
	})
	async upload(@Req() request: FastifyRequest): Promise<AssetDto> {
		const file = request.isMultipart() ? await request.file() : undefined;
		if (file?.fieldname !== "file") {
			throw new BadRequestException("Send the image in the file field");
		}
		const body = await file.toBuffer();
		const type = detectImageType(body);
		if (!type) {
			throw new UnsupportedMediaTypeException(
				"The file must be a JPEG, PNG, WebP or AVIF image",
			);
		}
		return this.assets.create(body, type);
	}

	/** Removes a catalog image and its file. */
	@Delete(":id")
	@HttpCode(204)
	@PanelScoped()
	@ApiNoContentResponse({ description: "Removed." })
	@ApiNotFoundResponse({ description: "The store has no such asset." })
	async remove(@Param("id") id: string): Promise<void> {
		const assetId = AssetId.tryParse(id);
		if (!assetId || !(await this.assets.remove(assetId))) {
			throw new NotFoundException("Asset not found");
		}
	}
}
