import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@rinde/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@rinde/data": new URL("./packages/data/src/index.ts", import.meta.url).pathname,
    },
  },
});
