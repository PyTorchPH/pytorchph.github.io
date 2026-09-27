import type { ViewerContext } from "@pytorch-ph/domain-server/identity";
import type { DeveloperDiagnostics, ProductView, ProductViewData } from "@pytorch-ph/domain-protocol/career-evidence";

const officerOnlyViews = new Set<ProductView>(["advisor", "connections", "job-operations"]);

export function isOfficerOnlyProductView(view: ProductView) {
  return officerOnlyViews.has(view);
}

export function memberSafeProductData(view: ProductView, payload: ProductViewData): ProductViewData {
  const { diagnostics: _diagnostics, ...safe } = payload;
  if (view !== "dashboard") return safe;
  return {
    ...safe,
    analytics: undefined,
    connections: undefined,
    operations: undefined,
    recommendations: undefined,
  };
}

export function developerDiagnostics(
  view: ProductView,
  payload: ProductViewData,
  viewer: ViewerContext,
  repositoryReadMs: number,
): DeveloperDiagnostics {
  return {
    schemaVersion: "1",
    build: {
      version: process.env.npm_package_version || "0.1.0",
      commit: process.env.PYTORCH_PH_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "development",
    },
    request: { route: `/api/product/${view}`, view, audience: "officer" },
    authorization: { role: viewer.role, isOfficer: true, diagnostics: true },
    data: {
      provider: payload.meta.provider,
      mode: payload.meta.mode,
      source: payload.meta.source,
      synthetic: payload.meta.synthetic,
      generatedAt: payload.meta.generatedAt,
    },
    performance: { repositoryReadMs: Math.max(0, Math.round(repositoryReadMs)) },
    warnings: payload.meta.synthetic ? ["Synthetic demo data; external actions remain disabled."] : [],
  };
}
