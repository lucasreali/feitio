import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CollectionsModule } from "../collections/collections.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ProductList } from "./product-list.js";
import { ProductVariantsRepository } from "./product-variants.repository.js";
import { ProductVariantsAdminController } from "./product-variants-admin.controller.js";
import { ProductsController } from "./products.controller.js";
import { ProductsRepository } from "./products.repository.js";
import { ProductsAdminController } from "./products-admin.controller.js";

@Module({
	imports: [AuthModule, CollectionsModule, StorageModule, TenancyModule],
	controllers: [
		ProductsController,
		ProductsAdminController,
		ProductVariantsAdminController,
	],
	providers: [ProductsRepository, ProductVariantsRepository, ProductList],
})
export class ProductsModule {}
