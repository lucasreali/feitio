import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { assets } from "../database/schemas/assets.js";
import type { AssetId } from "../domain/ids.js";
import { FileStorage } from "../storage/file-storage.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { AssetDto } from "./asset.dto.js";

/** Folder of the catalog images inside a tenant's files. */
const CATEGORY = "assets";

/** The current tenant's catalog images: the file in the public bucket and its row. */
@Injectable()
export class AssetsService {
	constructor(
		private readonly tenantDb: TenantDatabase,
		private readonly storage: FileStorage,
	) {}

	/** Stores an image whose type was checked from its bytes, and records it. */
	async create(body: Uint8Array, contentType: string): Promise<AssetDto> {
		const tenant = TenantContext.current();
		if (!tenant) {
			throw new Error("AssetsService needs a tenant context");
		}
		const file = await this.storage.upload({
			tenantId: tenant.id,
			visibility: "public",
			category: CATEGORY,
			body,
			contentType,
		});
		try {
			const [asset] = await this.tenantDb.run((tx) =>
				tx
					.insert(assets)
					.values({ tenantId: tenant.id, key: file.key })
					.returning({ id: assets.id }),
			);
			return { id: asset.id, url: this.storage.publicUrl(file.key) };
		} catch (error) {
			// Without its row the file could never be found or removed again.
			await this.storage.remove(file);
			throw error;
		}
	}

	/** Removes the asset and its file; false if the tenant has no such asset. */
	remove(id: AssetId): Promise<boolean> {
		return this.tenantDb.run(async (tx) => {
			const [asset] = await tx
				.delete(assets)
				.where(eq(assets.id, id))
				.returning({ key: assets.key });
			if (!asset) {
				return false;
			}
			// Inside the transaction: if the file cannot be removed, the row stays.
			await this.storage.remove({ visibility: "public", key: asset.key });
			return true;
		});
	}
}
