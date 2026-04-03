/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return {
      beforeFiles: [
        // proposal.atpressurewash.com/{token}/pdf → /proposal/{token}/pdf
        {
          source: "/:token/pdf",
          destination: "/proposal/:token/pdf",
          has: [{ type: "host", value: "proposal.atpressurewash.com" }],
        },
        // proposal.atpressurewash.com/{token}/v2 → /proposal/{token}/v2
        {
          source: "/:token/v2",
          destination: "/proposal/:token/v2",
          has: [{ type: "host", value: "proposal.atpressurewash.com" }],
        },
        // proposal.atpressurewash.com/{token} → /proposal/{token}
        {
          source: "/:token",
          destination: "/proposal/:token",
          has: [{ type: "host", value: "proposal.atpressurewash.com" }],
        },
      ],
      afterFiles: [
        // Proxy all /api/* calls through Next.js → Railway (eliminates CORS)
        {
          source: "/api/:path*",
          destination: `${apiUrl}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
