import { LocalProductRepository } from "./read-local";
import { SupabaseProductRepository } from "./read-supabase";
import type { ProductProvider, ProductRepository } from "@pytorch-ph/domain-protocol/career-evidence";

export function configuredProductProvider(): ProductProvider {
  if (process.env.NODE_ENV === "production" && process.env.PYTORCH_PH_DATA_PROVIDER !== "supabase") {
    throw new Error("Production requires PYTORCH_PH_DATA_PROVIDER=supabase; local demo data is disabled.");
  }
  return process.env.PYTORCH_PH_DATA_PROVIDER === "supabase" ? "supabase" : "local";
}

export function productRepository(): ProductRepository {
  return configuredProductProvider() === "supabase"
    ? new SupabaseProductRepository()
    : new LocalProductRepository();
}
