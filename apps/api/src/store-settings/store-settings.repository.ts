import { Injectable } from "@nestjs/common";
import {
	type StoreTheme,
	storeSettings,
} from "../database/schemas/store-settings.js";
import type { HttpsUrl } from "../domain/https-url.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { StoreSettingsChanges } from "./store-settings-changes.js";

/** What the stores and the panel show of a tenant's settings. */
export interface StoreSettingsView {
	displayName: string;
	logoUrl: HttpsUrl | null;
	theme: StoreTheme;
}

const view = {
	displayName: storeSettings.displayName,
	logoUrl: storeSettings.logoUrl,
	theme: storeSettings.theme,
};

@Injectable()
export class StoreSettingsRepository {
	constructor(private readonly tenantDb: TenantDatabase) {}

	/** The current tenant's settings. RLS scopes the query; no tenant filter needed. */
	async findCurrent(): Promise<StoreSettingsView | undefined> {
		const [settings] = await this.tenantDb.run((tx) =>
			tx.select(view).from(storeSettings).limit(1),
		);
		return settings;
	}

	/** Applies the changes to the current tenant's settings; undefined if it has none. */
	async updateCurrent(
		changes: StoreSettingsChanges,
	): Promise<StoreSettingsView | undefined> {
		const [settings] = await this.tenantDb.run((tx) =>
			tx.update(storeSettings).set(changes).returning(view),
		);
		return settings;
	}
}
