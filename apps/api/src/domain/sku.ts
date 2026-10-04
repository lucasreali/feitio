import { type Brand, brandedString } from "./brand.js";

const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A variant's stock keeping unit, unique per tenant: letters, digits, dots, dashes and underscores. */
export type Sku = Brand<string, "Sku">;
export const Sku = brandedString("Sku", (value) => SKU.test(value));
