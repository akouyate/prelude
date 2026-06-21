import { existsSync, readFileSync } from "node:fs";

import type { NextConfig } from "next";

loadRootEnv();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@prelude/contracts",
    "@prelude/core",
    "@prelude/design-system",
    "@prelude/types",
    "@prelude/ui"
  ]
};

export default nextConfig;

function loadRootEnv() {
  const envUrl = new URL("../../.env", import.meta.url);

  if (!existsSync(envUrl)) {
    return;
  }

  for (const line of readFileSync(envUrl, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseEnvValue(rawValue ?? "");
  }
}

function parseEnvValue(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/u, "");
}
