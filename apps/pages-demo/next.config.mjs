// Project-site hosts served under a path build with PAGES_BASE_PATH, for example /pytorch-demo.
const basePath = process.env.PAGES_BASE_PATH || "";
if (basePath && !/^\/[\w-]+$/.test(basePath)) throw new Error(`Invalid PAGES_BASE_PATH: ${basePath}`);

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  ...(basePath ? { basePath } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_STATIC_DEMO: "1" },
  transpilePackages: ["@pytorch-ph/design-system", "@pytorch-ph/domain-client", "@pytorch-ph/domain-protocol"],
};
