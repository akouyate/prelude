import type { NextConfig } from "next";

const extraAllowedDevOrigins =
  process.env.PRELUDE_ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "*.ngrok.app",
    "*.ngrok-free.app",
    ...extraAllowedDevOrigins
  ],
  transpilePackages: [
    "@prelude/contracts",
    "@prelude/design-system",
    "@prelude/types",
    "@prelude/ui"
  ]
};

export default nextConfig;
