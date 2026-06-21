/** @type {import("next").NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/todo-engine/:path*",
        destination: "http://127.0.0.1:3002/:path*",
      },
    ];
  },
};

export default nextConfig;
