import { LocalProductRepository } from "./read-local";
import type { ProductProvider, ProductRepository } from "@pytorch-ph/domain-protocol/career-evidence";

// Deployed portals read product data from the Rust API gateway; this module serves only the local demo store.
export function configuredProductProvider(): ProductProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The local product store is disabled in production; deployed portals use the Rust API.");
  }
  return "local";
}

export function productRepository(): ProductRepository {
  configuredProductProvider();
  return new LocalProductRepository();
}
