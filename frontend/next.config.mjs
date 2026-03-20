/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  },
  async rewrites() {
    return {
      beforeFiles: [
        // proposal.atpressurewash.com/{token} → /proposal/{token}
        {
          source: "/:token",
          destination: "/proposal/:token",
          has: [{ type: "host", value: "proposal.atpressurewash.com" }],
        },
      ],
    };
  },
};

export default nextConfig;
