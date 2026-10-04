import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SessionModule } from "../session/session.module.js";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { LoginAttempts } from "./login-attempts.js";
import { MembershipsRepository } from "./memberships.repository.js";
import { PanelGuard } from "./panel.guard.js";
import { UsersRepository } from "./users.repository.js";

/** Admin panel access. Import it to use @PanelScoped() in a module. */
@Module({
	imports: [DatabaseModule, SessionModule, ValkeyModule],
	controllers: [AuthController],
	providers: [
		AuthService,
		LoginAttempts,
		UsersRepository,
		MembershipsRepository,
		PanelGuard,
	],
	exports: [SessionModule, MembershipsRepository, PanelGuard, LoginAttempts],
})
export class AuthModule {}
