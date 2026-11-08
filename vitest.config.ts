import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `prototypes/` stays out on purpose: it has its own Rust tests and isn't part of the product.
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
  },
});
