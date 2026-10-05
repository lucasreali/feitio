import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { translateConstraints } from "../database/pg-error.js";
import { productVariants } from "../database/schemas/product-variants.js";
import { products } from "../database/schemas/products.js";
import { shippingMethods } from "../database/schemas/shipping-methods.js";
import type { ShippingMethodId } from "../domain/ids.js";
import { Money } from "../domain/money.js";
import { TenantContext } from "../tenancy/tenant-context.js";
import { TenantDatabase } from "../tenancy/tenant-database.js";
import type { ShippingMethodDto } from "./shipping.dto.js";
import type { Parcel } from "./shipping-calculator.js";
import type {
	NewShippingMethod,
	ShippingCalculators,
	ShippingMethodChanges,
	Simulation,
} from "./shipping-input.js";

export const SHIPPING_CALCULATORS = Symbol("SHIPPING_CALCULATORS");

const nameTaken = {
	shipping_methods_tenant_name_unique: () =>
		new ConflictException(
			"The store already has a shipping method with this name",
		),
};

const columns = {
	id: shippingMethods.id,
	name: shippingMethods.name,
	kind: shippingMethods.kind,
	config: shippingMethods.config,
	enabled: shippingMethods.enabled,
};

/** The current tenant's shipping methods. */
@Injectable()
export class ShippingMethodsRepository {
	constructor(
		private readonly tenantDb: TenantDatabase,
		@Inject(SHIPPING_CALCULATORS)
		private readonly calculators: ShippingCalculators,
	) {}

	/** Every method, by name. */
	list(): Promise<ShippingMethodDto[]> {
		return this.tenantDb.run(
			(tx) =>
				tx
					.select(columns)
					.from(shippingMethods)
					.orderBy(
						asc(shippingMethods.name),
						asc(shippingMethods.id),
					) as Promise<ShippingMethodDto[]>,
		);
	}

	/**
	 * Units of a variant as a parcel, for a product page's simulation;
	 * undefined when the store does not sell it (unknown, or of a product
	 * that is not active).
	 */
	variantParcel({
		variantId,
		cep,
		quantity,
	}: Simulation): Promise<Parcel | undefined> {
		return this.tenantDb.run(async (tx) => {
			const [variant] = await tx
				.select({
					unitPrice: productVariants.price,
					weight: productVariants.weight,
					height: productVariants.height,
					width: productVariants.width,
					length: productVariants.length,
				})
				.from(productVariants)
				.innerJoin(
					products,
					and(
						eq(products.id, productVariants.productId),
						eq(products.status, "active"),
					),
				)
				.where(eq(productVariants.id, variantId));
			return (
				variant && {
					destination: cep,
					subtotal: Money.parse(variant.unitPrice * quantity),
					items: [{ variantId, quantity, ...variant }],
				}
			);
		});
	}

	/** The methods offered to buyers. */
	async enabled(): Promise<ShippingMethodDto[]> {
		return (await this.list()).filter((method) => method.enabled);
	}

	/** 409 for a name in use. */
	create(method: NewShippingMethod): Promise<ShippingMethodDto> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [created] = await tx
						.insert(shippingMethods)
						.values({ ...method, tenantId: TenantContext.id() })
						.returning(columns);
					return created as ShippingMethodDto;
				}),
			nameTaken,
		);
	}

	/**
	 * undefined when the store has no such method; 400 for settings that do
	 * not fit its kind, 409 for a name in use.
	 */
	update(
		id: ShippingMethodId,
		{ config, ...changes }: ShippingMethodChanges,
	): Promise<ShippingMethodDto | undefined> {
		return translateConstraints(
			() =>
				this.tenantDb.run(async (tx) => {
					const [method] = await tx
						.select({ kind: shippingMethods.kind })
						.from(shippingMethods)
						.where(eq(shippingMethods.id, id))
						.for("update");
					if (!method) {
						return undefined;
					}
					const [updated] = await tx
						.update(shippingMethods)
						.set(
							config === undefined
								? changes
								: {
										...changes,
										config: this.calculators[
											method.kind
										].parseConfig(config),
									},
						)
						.where(eq(shippingMethods.id, id))
						.returning(columns);
					return updated as ShippingMethodDto;
				}),
			nameTaken,
		);
	}
}
