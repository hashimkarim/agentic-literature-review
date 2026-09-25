import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ManuscriptDocument } from "../packages/contracts/src/index";

// Starts a disposable native-browser target. No SDK connection or live inference.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-review-ui-"));
const backendPort = Number(process.env.LITAGENT_REVIEW_PORT ?? 3887);
const webPort = Number(process.env.LITAGENT_REVIEW_WEB_PORT ?? 5184);
for (const port of [backendPort, webPort]) {
  assert(Number.isInteger(port) && port > 1024 && port < 65536);
  let occupied = false;
  try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch { /* Unused target. */ }
  assert(!occupied, `Port ${port} is already occupied; select another fixture port.`);
}
const children: ReturnType<typeof spawn>[] = [];
function start(args: string[], cwd: string, env: NodeJS.ProcessEnv, name: string) {
  const log = fs.openSync(path.join(output, `${name}.log`), "a", 0o600);
  const child = spawn("bunx", args, { cwd, env, stdio: ["ignore", log, log], detached: true });
  child.on("error", () => { /* Readiness reports the fixture log on failure. */ });
  fs.closeSync(log); child.unref(); children.push(child);
  return child;
}
const env: NodeJS.ProcessEnv = { ...process.env, LITAGENT_REPO: path.join(output, "research"), LITAGENT_PORT: String(backendPort) };
delete env.AGENTICDRIVER_URL; delete env.AGENTICDRIVER_TOKEN;
const backend = start(["tsx", "apps/server/src/index.ts"], root, env, "backend");
const web = start(["vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], path.join(root, "apps/web"), { ...env, LITAGENT_API_URL: `http://127.0.0.1:${backendPort}` }, "web");
async function wait(url: string) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* Startup only. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Fixture did not start: ${url}; logs in ${output}`);
}
try {
  const base = `http://127.0.0.1:${backendPort}/api`;
  await wait(`${base}/status`); await wait(`http://127.0.0.1:${webPort}`);
  const status = await (await fetch(`${base}/status`)).json() as { repoRoot: string };
  assert.equal(status.repoRoot, env.LITAGENT_REPO);
  const response = await fetch(`${base}/manuscripts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Synthetic review workspace", projectIds: [] }) });
  assert(response.ok);
  const manuscript = await response.json() as ManuscriptDocument;
  const content = ["\\section{Introduction}", "\\label{sec:introduction}", "", "This synthetic study compares two simulated approaches on a held-out dataset. The observations are illustrative and do not represent real experiments.", "", "Our revised approach reduces median latency while preserving the selected evaluation conditions.", "", "\\section{Limitations}", "", "The evaluation uses synthetic measurements. Further validation is required before drawing conclusions about deployment.", ""].join("\n");
  const saved = await fetch(`${base}/manuscripts/${manuscript.id}/files`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "sections/introduction.tex", content, expectedRevision: manuscript.files.find((file) => file.path === "sections/introduction.tex")!.revision }) });
  assert(saved.ok);
  const receipt = { url: `http://127.0.0.1:${webPort}`, api: `http://127.0.0.1:${backendPort}`, output, manuscriptId: manuscript.id, backendPid: backend.pid, webPid: web.pid, liveProviderCalls: 0 };
  fs.writeFileSync(path.join(output, "setup.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  for (const child of children) if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already exited. */ } }
  throw error;
}
