import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@prelude/contracts",
    "@prelude/design-system",
    "@prelude/types",
    "@prelude/ui"
  ]
};

export default nextConfig;
