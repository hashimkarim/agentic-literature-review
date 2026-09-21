import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: true
  },
  resolve: {
    alias: {
      "@litagent/agents/agenticdriver": fileURLToPath(new URL("./packages/agents/src/agenticdriver.ts", import.meta.url)),
      "@litagent/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
      "@litagent/library": fileURLToPath(new URL("./packages/library/src/index.ts", import.meta.url)),
      "@litagent/agents": fileURLToPath(new URL("./packages/agents/src/index.ts", import.meta.url)),
      "@litagent/workflows": fileURLToPath(new URL("./packages/workflows/src/index.ts", import.meta.url)),
      "@litagent/indexer": fileURLToPath(new URL("./packages/indexer/src/index.ts", import.meta.url))
    }
  }
});
