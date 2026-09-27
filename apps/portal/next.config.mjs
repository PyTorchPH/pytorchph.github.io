const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()"
  }
];
const viewerScriptPolicy = process.env.NODE_ENV === "development"
  ? "'self' 'unsafe-inline' 'unsafe-eval' blob:"
  : "'self' 'unsafe-inline' blob:";

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", "members.ph.localhost", "officers.ph.localhost"],
  transpilePackages: [
    "@pytorch-ph/design-system",
    "@pytorch-ph/domain-client",
    "@pytorch-ph/domain-protocol",
    "@pytorch-ph/domain-server"
  ],
  distDir: process.env.PYTORCH_PH_NEXT_DIST_DIR || ".next",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      },
      {
        source: "/career/resume-viewer",
        headers: [
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src ${viewerScriptPolicy}; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' data: blob:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'` },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" }
        ]
      }
    ];
  }
};

export default nextConfig;
