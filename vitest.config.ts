import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default; React-harness tests opt into jsdom per file via the
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"]
  }
});
