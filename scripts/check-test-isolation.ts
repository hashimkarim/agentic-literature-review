import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const configFile = path.join(root, "vitest.config.ts");
const importer = path.join(root, "packages/agents/src/agenticdriver.test.ts");
const localPackages: Record<string, string> = {
  "@litagent/contracts": "packages/contracts/src/index.ts",
  "@litagent/library": "packages/library/src/index.ts",
  "@litagent/agents": "packages/agents/src/index.ts",
  "@litagent/agents/agenticdriver": "packages/agents/src/agenticdriver.ts",
  "@litagent/workflows": "packages/workflows/src/index.ts",
  "@litagent/indexer": "packages/indexer/src/index.ts"
};
const sdkPackages = ["agenticdriver", "agenticdriver/client", "agenticdriver/providers", "agenticdriver/server"];

// Resolve through the same config and Vite plugin pipeline as Vitest. This
// performs no provider execution and does not start an HTTP listener.
const server = await createServer({
  configFile,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] }
});

try {
  assert.equal(realpathSync(server.config.root), root, "Vitest root must be this checkout");
  const resolutions = [];
  for (const specifier of [...Object.keys(localPackages), ...sdkPackages]) {
    const resolution = await server.pluginContainer.resolveId(specifier, importer);
    assert.ok(resolution && path.isAbsolute(resolution.id), `${specifier} did not resolve to a local file`);
    const resolved = realpathSync(resolution.id);
    const relative = path.relative(root, resolved);
    assert.ok(
      relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${specifier} resolves outside this checkout: ${resolved}`
    );
    const expected = localPackages[specifier];
    if (expected) {
      assert.equal(resolved, path.join(root, expected), `${specifier} must resolve to this checkout's source`);
    } else {
      assert.ok(relative.split(path.sep).includes("node_modules"), `${specifier} must use an installed SDK package`);
    }
    resolutions.push({
      specifier,
      resolved,
      sha256: createHash("sha256").update(readFileSync(resolved)).digest("hex")
    });
  }
  console.log(JSON.stringify({ status: "passed", root, cwd: process.cwd(), configFile, importer, resolutions }, null, 2));
} finally {
  await server.close();
}
