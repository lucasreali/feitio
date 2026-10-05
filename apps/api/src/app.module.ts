import { Module } from "@nestjs/common";
import { AssetsModule } from "./assets/assets.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CollectionsModule } from "./collections/collections.module.js";
import { CustomersModule } from "./customers/customers.module.js";
import { FacetsModule } from "./facets/facets.module.js";
import { HealthModule } from "./health/health.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { ProductsModule } from "./products/products.module.js";
import { SessionModule } from "./session/session.module.js";
import { ShippingModule } from "./shipping/shipping.module.js";
import { StockModule } from "./stock/stock.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { StoreSettingsModule } from "./store-settings/store-settings.module.js";

@Module({
	imports: [
		AssetsModule,
		AuthModule,
		CollectionsModule,
		CustomersModule,
		FacetsModule,
		HealthModule,
		OrdersModule,
		ProductsModule,
		SessionModule,
		ShippingModule,
		StockModule,
		StorageModule,
		StoreSettingsModule,
	],
})
export class AppModule {}
