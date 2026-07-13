/** @type {import("next").NextConfig} */
const todoEngineApiUrl = process.env.TODO_ENGINE_API_URL ?? "http://127.0.0.1:3002";

const nextConfig = {
  output: "export",
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          return [
            {
              source: "/todo-engine/:path*",
              destination: `${todoEngineApiUrl}/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
