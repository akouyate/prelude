import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `@/*` path in tsconfig.json. Next and `tsc` both honour it,
      // so route handlers and app-directory files use it idiomatically; without
      // it here, importing one of those files from a test fails to resolve.
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"]
  }
});
