import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    globals: true
  },
  resolve: {
    // Exact package matches preserve exported subpaths such as
    // @litagent/agents/agenticdriver instead of appending them to index.ts.
    alias: [
      { find: /^@litagent\/contracts$/, replacement: fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)) },
      { find: /^@litagent\/library$/, replacement: fileURLToPath(new URL("./packages/library/src/index.ts", import.meta.url)) },
      { find: /^@litagent\/agents$/, replacement: fileURLToPath(new URL("./packages/agents/src/index.ts", import.meta.url)) },
      { find: /^@litagent\/workflows$/, replacement: fileURLToPath(new URL("./packages/workflows/src/index.ts", import.meta.url)) },
      { find: /^@litagent\/indexer$/, replacement: fileURLToPath(new URL("./packages/indexer/src/index.ts", import.meta.url)) }
    ]
  }
});
