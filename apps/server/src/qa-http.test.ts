import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

it("returns HTTP conflicts for stale chat writes without starting a provider", async () => {
  const reserved = net.createServer();
  await new Promise<void>((resolve) => reserved.listen(0, "127.0.0.1", resolve));
  const port = (reserved.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserved.close((error) => error ? reject(error) : resolve()));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-qa-http-"));
  const server = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, LITAGENT_PORT: String(port), LITAGENT_REPO: root, AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = new Promise<void>((resolve) => { server.once("exit", () => resolve()); server.once("error", () => resolve()); });
  let output = "";
  server.stdout.on("data", (chunk) => { output += String(chunk); });
  server.stderr.on("data", (chunk) => { output += String(chunk); });
  const url = `http://127.0.0.1:${port}`;
  try {
    await vi.waitFor(async () => {
      if (server.exitCode !== null) throw new Error(output);
      const response = await fetch(`${url}/api/qa/thread`, { signal: AbortSignal.timeout(1_000) });
      expect(response.status).toBe(200);
    }, { timeout: 15_000, interval: 100 });
    const cleared = await fetch(`${url}/api/qa/thread?threadRevision=0`, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ revision: 1 });
    const stale = await fetch(`${url}/api/qa`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Do not execute", providerId: "fixture-never-executed", threadRevision: 0 })
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "qa_thread_changed" });
    const staleArchive = await fetch(`${url}/api/qa/thread?threadRevision=0`, { method: "DELETE" });
    expect(staleArchive.status).toBe(409);
    expect(await staleArchive.json()).toMatchObject({ code: "qa_thread_changed" });
    const runs = await fetch(`${url}/api/workflows`);
    expect(await runs.json()).toEqual([]);
    const current = await fetch(`${url}/api/qa/thread`);
    expect(await current.json()).toMatchObject({ revision: 1, messages: [] });
    const citation = await fetch(`${url}/api/papers/missing/passages/old/target`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedQuote: "Previously cited text" })
    });
    expect(citation.status).toBe(409);
    expect(await citation.json()).toMatchObject({ code: "citation_source_changed" });
  } finally {
    server.kill("SIGTERM");
    await exited;
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
