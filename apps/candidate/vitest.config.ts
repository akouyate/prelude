import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next compiles JSX itself, so the app tsconfig keeps `jsx: preserve`. Vitest
  // has no such downstream step and needs the transform spelled out, otherwise
  // any test rendering a component fails to parse.
  oxc: {
    jsx: { runtime: "automatic" }
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"]
  }
});
