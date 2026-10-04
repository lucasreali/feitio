import { Injectable } from "@nestjs/common";
import { storeSettings } from "../database/schemas/store-settings.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";

@Injectable()
export class StoreSettingsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** The current tenant's settings. RLS scopes the query; no tenant filter needed. */
	async findCurrent() {
		const [settings] = await this.tenantDb.run((tx) =>
			tx
				.select({
					displayName: storeSettings.displayName,
					logoUrl: storeSettings.logoUrl,
					theme: storeSettings.theme,
				})
				.from(storeSettings)
				.limit(1),
		);
		return settings;
	}
}
