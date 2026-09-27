/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  transpilePackages: ["@pytorch-ph/design-system", "@pytorch-ph/domain-client", "@pytorch-ph/domain-protocol"],
  // The static demo cannot reach Supabase; this swaps only the browser auth client for a demo stub.
  turbopack: { resolveAlias: { "@pytorch-ph/domain-client/identity": "./app/demo-identity.ts" } },
};
