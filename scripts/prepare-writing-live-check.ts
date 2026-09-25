import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WritingAttachmentInput } from "../packages/contracts/src/index";

// Opt-in setup only: model requests require an explicit action in the isolated app.
const tokenFile = process.env.LITAGENT_LIVE_TOKEN_FILE;
const driverUrl = process.env.AGENTICDRIVER_URL;
assert(tokenFile && driverUrl, "Set LITAGENT_LIVE_TOKEN_FILE and AGENTICDRIVER_URL for the explicitly authorized host.");
const host = new URL(driverUrl);
assert(["http:", "https:"].includes(host.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) && !host.username && !host.password && !host.search && !host.hash, "Live-check setup accepts only a loopback SDK host without URL credentials or query parameters.");
const token = fs.readFileSync(tokenFile, "utf8").trim();
assert(token.length > 0, "The private credential file is empty.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert(fs.existsSync(path.join(root, "apps/web/dist/index.html")), "Run bun run build before preparing the isolated app.");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-live-"));
fs.chmodSync(output, 0o700);
const researchRoot = path.join(output, "research");
const port = Number(process.env.LITAGENT_LIVE_PORT ?? 3886);
assert(Number.isInteger(port) && port > 1024 && port < 65536, "Choose an unoccupied test port.");
const baseUrl = `http://127.0.0.1:${port}`;
let occupied = false;
try { await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* An unused loopback port is expected. */ }
assert(!occupied, "The test port is already occupied; choose another port.");
const log = fs.openSync(path.join(output, "server.log"), "a", 0o600);
const child = spawn("bunx", ["tsx", "apps/server/src/index.ts"], { cwd: root, detached: true, stdio: ["ignore", log, log], env: {
  ...process.env, LITAGENT_PORT: String(port), LITAGENT_REPO: researchRoot, AGENTICDRIVER_URL: driverUrl, AGENTICDRIVER_TOKEN: token
} });
let startError: Error | undefined;
child.on("error", (error) => { startError = error; });
child.unref();
fs.closeSync(log);

async function request<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert(response.ok, `Isolated app request failed (${response.status}): ${route}`);
  return response.json() as Promise<T>;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (startError) throw new Error("The isolated server process could not start.", { cause: startError });
    assert(child.exitCode === null, "The isolated server exited before readiness; inspect its private server.log.");
    try { const response = await fetch(`${baseUrl}/api/projects`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch { /* Startup watchdog, never a generation timeout. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "The isolated app did not start; inspect its private server.log.");
  const status = await request<{ repoRoot: string }>("/api/status");
  assert(status.repoRoot === researchRoot, "Refusing to seed a server that does not own the disposable repository.");
  const manuscript = await request<{ id: string; files: Array<{ path: string; revision: string }> }>("/api/manuscripts", { name: "Synthetic writing acceptance", projectIds: [] });
  const source = await request<{ id: string }>(`/api/manuscripts/${manuscript.id}/sources`, {
    kind: "results", content: "Synthetic experiment only. On the same 100 simulated cases, baseline median latency was 40 ms and the revised implementation was 30 ms. This is a 25% reduction. No accuracy evaluation was performed. These are invented fixture results, not measurements from a real study.",
    path: "synthetic-results.txt", originUrl: null
  } satisfies WritingAttachmentInput);
  const excluded = await request<{ id: string }>(`/api/manuscripts/${manuscript.id}/sources`, {
    kind: "notes", content: "UNSELECTED_CONTEXT_SENTINEL: The unrelated synthetic control uses 999 ms. This source must not be selected or sent.", path: "unselected.txt", originUrl: null
  } satisfies WritingAttachmentInput);
  const receipt = { baseUrl, pid: child.pid, output, manuscriptId: manuscript.id, selectedSourceId: source.id, excludedSourceId: excluded.id, generationCallsBySetup: 0 };
  fs.writeFileSync(path.join(output, "setup.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  if (child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch (stopError) { if ((stopError as NodeJS.ErrnoException).code !== "ESRCH") throw stopError; }
  }
  throw error;
}
