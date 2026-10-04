import { Module } from "@nestjs/common";
import { ValkeyModule } from "../valkey/valkey.module.js";
import { CsrfController } from "./csrf.controller.js";
import { readSessionConfig, SESSION_CONFIG } from "./session.config.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";

@Module({
	imports: [ValkeyModule],
	controllers: [CsrfController],
	providers: [
		{ provide: SESSION_CONFIG, useFactory: readSessionConfig },
		SessionService,
		SessionGuard,
	],
	exports: [SessionService, SessionGuard],
})
export class SessionModule {}
