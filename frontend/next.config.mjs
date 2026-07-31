/** @type {import("next").NextConfig} */
const ravenApiUrl = process.env.RAVEN_API_URL ?? "http://127.0.0.1:3002";

const nextConfig = {
  output: "export",
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${ravenApiUrl}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
