import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CollectionsController } from "./collections.controller.js";
import { CollectionsRepository } from "./collections.repository.js";
import { CollectionsAdminController } from "./collections-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [CollectionsController, CollectionsAdminController],
	providers: [CollectionsRepository],
	exports: [CollectionsRepository],
})
export class CollectionsModule {}
