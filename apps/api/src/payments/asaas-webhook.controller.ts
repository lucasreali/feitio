import {
	Body,
	Controller,
	Headers,
	HttpCode,
	Inject,
	Param,
	Post,
	UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.js";
import { processedJobs } from "../database/schemas/processed-jobs.js";
import { tenants } from "../database/schemas/tenants.js";
import { TenantId } from "../domain/ids.js";
import { publishEvent } from "../events/publish-event.js";
import { isObject } from "../http/request-body.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import { PaymentAccounts } from "./payment-accounts.js";

/**
 * Asaas's notifications of each store's payments, at the URL given when its
 * account was opened. The `asaas-access-token` header must be the store's
 * token (401 otherwise, the same for any store). Each notification is
 * queued once, by its id, for the worker (PaymentNotifications); the answer
 * is quick, as Asaas asks.
 */
@ApiExcludeController()
@Controller("webhooks/asaas")
export class AsaasWebhookController {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly tenantDb: TenantDatabase,
		private readonly accounts: PaymentAccounts,
	) {}

	@Post(":tenantId")
	@HttpCode(200)
	async notify(
		@Param("tenantId") id: string,
		@Headers("asaas-access-token") token: string | undefined,
		@Body() body: unknown,
	): Promise<void> {
		const tenantId = TenantId.tryParse(id);
		const [tenant] = tenantId
			? await this.db
					.select({ id: tenants.id, slug: tenants.slug })
					.from(tenants)
					.where(eq(tenants.id, tenantId))
			: [];
		if (!tenant) {
			throw new UnauthorizedException();
		}
		await TenantContext.run(tenant, () =>
			this.tenantDb.run(async (tx) => {
				if (!(await this.accounts.acceptsWebhook(tx, token))) {
					throw new UnauthorizedException();
				}
				const notification = isObject(body) ? body : {};
				const { payment } = notification;
				// Only payments' notifications matter; others are taken and dropped.
				if (
					typeof notification.id !== "string" ||
					!isObject(payment) ||
					typeof payment.id !== "string"
				) {
					return;
				}
				const [first] = await tx
					.insert(processedJobs)
					.values({
						tenantId: tenant.id,
						key: `asaas-webhook.${notification.id}`,
					})
					.onConflictDoNothing()
					.returning({ key: processedJobs.key });
				if (first) {
					await publishEvent(tx, {
						type: "payment.notified",
						gatewayId: payment.id,
					});
				}
			}),
		);
	}
}
