import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SessionModule } from "../session/session.module.js";
import { MembershipsRepository } from "./memberships.repository.js";
import { PanelGuard } from "./panel.guard.js";

/** Admin panel access. Import it to use @PanelScoped() in a module. */
@Module({
	imports: [DatabaseModule, SessionModule],
	providers: [MembershipsRepository, PanelGuard],
	exports: [SessionModule, MembershipsRepository, PanelGuard],
})
export class AuthModule {}
