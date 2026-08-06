import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "www.wasserundgruen.de",
      },
    ],
  },
  transpilePackages: ["mapbox-gl"],
};

export default nextConfig;
