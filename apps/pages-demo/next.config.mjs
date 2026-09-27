// Project-site hosts (for example the FIT Pages site) build with PAGES_BASE_PATH=/pytorch-fit-system.
const basePath = process.env.PAGES_BASE_PATH || "";
if (basePath && !/^\/[\w-]+$/.test(basePath)) throw new Error(`Invalid PAGES_BASE_PATH: ${basePath}`);

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ["@pytorch-ph/design-system", "@pytorch-ph/domain-client", "@pytorch-ph/domain-protocol"],
  // The static demo cannot reach Supabase; this swaps only the browser auth client for a demo stub.
  turbopack: { resolveAlias: { "@pytorch-ph/domain-client/identity": "./app/demo-identity.ts" } },
};
