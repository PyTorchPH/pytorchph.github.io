/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
  transpilePackages: ["@pytorch-ph/design-system", "@pytorch-ph/domain-client", "@pytorch-ph/domain-protocol"],
};
