import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: true
  },
  resolve: {
    alias: {
      "@litagent/contracts": "/mnt/shared/Git/agentic-literature-review/packages/contracts/src/index.ts",
      "@litagent/library": "/mnt/shared/Git/agentic-literature-review/packages/library/src/index.ts",
      "@litagent/agents": "/mnt/shared/Git/agentic-literature-review/packages/agents/src/index.ts",
      "@litagent/workflows": "/mnt/shared/Git/agentic-literature-review/packages/workflows/src/index.ts",
      "@litagent/indexer": "/mnt/shared/Git/agentic-literature-review/packages/indexer/src/index.ts"
    }
  }
});
