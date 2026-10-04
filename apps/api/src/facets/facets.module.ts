import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { FacetsController } from "./facets.controller.js";
import { FacetsRepository } from "./facets.repository.js";
import { FacetsAdminController } from "./facets-admin.controller.js";

@Module({
	imports: [AuthModule, TenancyModule],
	controllers: [FacetsController, FacetsAdminController],
	providers: [FacetsRepository],
})
export class FacetsModule {}
