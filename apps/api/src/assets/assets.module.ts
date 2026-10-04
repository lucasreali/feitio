import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AssetsService } from "./assets.service.js";
import { AssetsAdminController } from "./assets-admin.controller.js";

@Module({
	imports: [AuthModule, StorageModule, TenancyModule],
	controllers: [AssetsAdminController],
	providers: [AssetsService],
})
export class AssetsModule {}
