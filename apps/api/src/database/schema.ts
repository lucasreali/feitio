import { assets } from "./schemas/assets.js";
import { collectionFacetValues } from "./schemas/collection-facet-values.js";
import { collectionProducts } from "./schemas/collection-products.js";
import { collections } from "./schemas/collections.js";
import { customerAddresses } from "./schemas/customer-addresses.js";
import { customerEvents } from "./schemas/customer-events.js";
import { customerGroupMembers } from "./schemas/customer-group-members.js";
import { customerGroups } from "./schemas/customer-groups.js";
import { customers } from "./schemas/customers.js";
import { domainEvents } from "./schemas/domain-events.js";
import { facetValues } from "./schemas/facet-values.js";
import { facets } from "./schemas/facets.js";
import { memberships } from "./schemas/memberships.js";
import { processedJobs } from "./schemas/processed-jobs.js";
import { productFacetValues } from "./schemas/product-facet-values.js";
import { productImages } from "./schemas/product-images.js";
import { productOptionGroups } from "./schemas/product-option-groups.js";
import { productOptions } from "./schemas/product-options.js";
import { productVariantOptions } from "./schemas/product-variant-options.js";
import { productVariants } from "./schemas/product-variants.js";
import { products } from "./schemas/products.js";
import { stockLevels } from "./schemas/stock-levels.js";
import { stockLocations } from "./schemas/stock-locations.js";
import { stockMovements } from "./schemas/stock-movements.js";
import { storeSettings } from "./schemas/store-settings.js";
import { tenants } from "./schemas/tenants.js";
import { users } from "./schemas/users.js";

/** Every table of the system, passed to the Drizzle client. One file per table in `schemas/`. */
export const schemas = {
	tenants,
	storeSettings,
	users,
	memberships,
	assets,
	products,
	productImages,
	productOptionGroups,
	productOptions,
	productVariants,
	productVariantOptions,
	facets,
	facetValues,
	productFacetValues,
	collections,
	collectionProducts,
	collectionFacetValues,
	stockLocations,
	stockLevels,
	stockMovements,
	customers,
	customerAddresses,
	customerGroups,
	customerGroupMembers,
	customerEvents,
	domainEvents,
	processedJobs,
};
