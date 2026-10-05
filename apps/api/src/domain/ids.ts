import { type Brand, brandedString } from "./brand.js";
import { isUuidV7, uuidv7 } from "./uuid-v7.js";

/**
 * Entity ids are UUID v7 (time-ordered). The database generates them by
 * default with uuid_generate_v7() and refuses other versions on new rows.
 */
const entityId = <Name extends string>(name: Name) => {
	const parser = brandedString(name, isUuidV7);
	return {
		...parser,
		/** A new id, for rows the API creates with a known id. */
		generate: () => parser.parse(uuidv7()),
	};
};

/** Id of a tenant (a merchant). */
export type TenantId = Brand<string, "TenantId">;
export const TenantId = entityId("TenantId");

/** Id of a user of the admin panel. */
export type UserId = Brand<string, "UserId">;
export const UserId = entityId("UserId");

/** Id of a membership: a user's access to a tenant, with a role. */
export type MembershipId = Brand<string, "MembershipId">;
export const MembershipId = entityId("MembershipId");

/** Id of an asset: an image of the store's catalog in the public bucket. */
export type AssetId = Brand<string, "AssetId">;
export const AssetId = entityId("AssetId");

/** Id of a product of the store's catalog. */
export type ProductId = Brand<string, "ProductId">;
export const ProductId = entityId("ProductId");

/** Id of a product's option group, such as Size. */
export type ProductOptionGroupId = Brand<string, "ProductOptionGroupId">;
export const ProductOptionGroupId = entityId("ProductOptionGroupId");

/** Id of an option of a group, such as M. */
export type ProductOptionId = Brand<string, "ProductOptionId">;
export const ProductOptionId = entityId("ProductOptionId");

/** Id of a product variant: what is sold, stocked and ordered. */
export type ProductVariantId = Brand<string, "ProductVariantId">;
export const ProductVariantId = entityId("ProductVariantId");

/** Id of a facet: an attribute for filtering, such as Brand. */
export type FacetId = Brand<string, "FacetId">;
export const FacetId = entityId("FacetId");

/** Id of a facet value, such as Nike. */
export type FacetValueId = Brand<string, "FacetValueId">;
export const FacetValueId = entityId("FacetValueId");

/** Id of a collection of products. */
export type CollectionId = Brand<string, "CollectionId">;
export const CollectionId = entityId("CollectionId");

/** Id of a place where a store keeps stock. */
export type StockLocationId = Brand<string, "StockLocationId">;
export const StockLocationId = entityId("StockLocationId");

/** Id of a recorded change to a variant's stock. */
export type StockMovementId = Brand<string, "StockMovementId">;
export const StockMovementId = entityId("StockMovementId");

/** Id of a customer of a store: a guest or a registered buyer. */
export type CustomerId = Brand<string, "CustomerId">;
export const CustomerId = entityId("CustomerId");

/** Id of an address in a customer's address book. */
export type CustomerAddressId = Brand<string, "CustomerAddressId">;
export const CustomerAddressId = entityId("CustomerAddressId");

/** Id of a group of customers, for promotions and prices. */
export type CustomerGroupId = Brand<string, "CustomerGroupId">;
export const CustomerGroupId = entityId("CustomerGroupId");

/** Id of an entry of a customer's history. */
export type CustomerEventId = Brand<string, "CustomerEventId">;
export const CustomerEventId = entityId("CustomerEventId");

/** Id of a domain event: something that happened in a store, for the worker. */
export type DomainEventId = Brand<string, "DomainEventId">;
export const DomainEventId = entityId("DomainEventId");

/** Id of an order; a cart is an order that has not been placed. */
export type OrderId = Brand<string, "OrderId">;
export const OrderId = entityId("OrderId");

/** Id of a line of an order: one variant and its quantity. */
export type OrderLineId = Brand<string, "OrderLineId">;
export const OrderLineId = entityId("OrderLineId");

/** Id of an entry of an order's history. */
export type OrderEventId = Brand<string, "OrderEventId">;
export const OrderEventId = entityId("OrderEventId");
