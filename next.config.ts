import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/engine-move": ["./vendor/pikafish/**"],
  },
  reactStrictMode: true,
};

export default nextConfig;