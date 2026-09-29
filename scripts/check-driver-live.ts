import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readConnectionProfile } from "@agenticdriver/sdk/connections";
import type { ProviderPanelState } from "@agenticdriver/sdk/panel";
import { LitAgentRepository, ManuscriptStore } from "../packages/library/src/index";
import type { AgentProvider, QaResponse, WritingContext, WritingCandidateBatch } from "../packages/contracts/src/index";

// Explicit opt-in, real host only. No SDK host, completion substitute, account
// probe, fallback, or retry is created here. Every research file is disposable.
const profilePath = process.env.LITAGENT_LIVE_PROFILE;
const instance = process.env.LITAGENT_LIVE_PROVIDER;
const model = process.env.LITAGENT_LIVE_MODEL;
assert.ok(profilePath && instance && model, "Set LITAGENT_LIVE_PROFILE, LITAGENT_LIVE_PROVIDER and LITAGENT_LIVE_MODEL explicitly.");
const profile = await readConnectionProfile(profilePath);
const validGrant = () => assert.ok(Date.parse(profile.expiresAt) > Date.now(), "Validation grant expired; request renewal, never fall back.");
validGrant();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-alpha6-live-"));
fs.chmodSync(root, 0o700);
const research = path.join(root, "research");
const repo = new LitAgentRepository(research); repo.init();
const paper = repo.importPaper({ metadata: { title: "Lost in the Middle: public abstract reading notes", authors: ["Nelson F. Liu et al."], year: 2023, arxivId: "2307.03172" } }).paper;
const markdown = "# Public abstract reading notes\n\nSource: https://arxiv.org/abs/2307.03172v3\n\nThese notes paraphrase the abstract, not the full paper.\n\n## Findings\n\nThe study evaluates multi-document question answering and key-value retrieval. Model performance is often better when relevant information is near the beginning or end of the input. Accessing information in the middle of long contexts leads to a substantial drop, including for models designed for long contexts. These findings do not mean that every tested model fails on every long-context example.\n";
repo.writeMarkdown(paper.id, markdown);
const manuscripts = new ManuscriptStore(research);
const document = manuscripts.create({ name: "Public long-context writing check" });
const file = document.files.find((entry) => entry.path === "sections/introduction.tex")!;
const reservation = http.createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const cwd = fileURLToPath(new URL("../", import.meta.url));
const backend = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
  cwd, env: { ...process.env, LITAGENT_REPO: research, LITAGENT_PORT: String(port), AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
const log = fs.createWriteStream(path.join(root, "backend.log"), { mode: 0o600 });
backend.stdout.pipe(log); backend.stderr.pipe(log);
const exited = new Promise<void>((resolve) => backend.once("exit", () => resolve()));
const origin = `http://127.0.0.1:${port}`;
async function request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${route}`, { method, headers: { "Content-Type": "application/json", "X-LitAgent-Local": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${route} failed (${response.status}); inspect the private receipt directory.`);
  return response.json() as Promise<T>;
}
const receipt: Record<string, unknown> = { sdk: "0.2.0-alpha.6", provider: instance, model, endpoint: profile.url, paperId: paper.id, manuscriptId: document.id, checks: [] };
const checks = receipt.checks as string[];
const save = () => fs.writeFileSync(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
let stopping = false;
const stop = () => { stopping = true; backend.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.ok(backend.exitCode === null && !stopping, "Isolated app stopped before startup.");
    try { if ((await fetch(`${origin}/api/projects`)).ok) { ready = true; break; } } catch { /* Bounded app startup only, not model execution. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "App startup failed.");
  const empty = await request<ProviderPanelState>("/settings/driver/panel", "POST", { action: "snapshot" });
  assert.equal(empty.connected, false); assert.equal(empty.providers.length, 0); checks.push("empty onboarding");
  await request("/settings/driver", "PUT", { url: profile.url, tokenFile: path.resolve(path.dirname(profilePath), profile.tokenFile), label: "Prometheus alpha.6 validation", deviceName: "Prometheus" });
  const panel = await request<ProviderPanelState>("/settings/driver/panel", "POST", { action: "snapshot", refresh: true });
  assert.equal(panel.connected, true); assert.equal(panel.management, undefined); checks.push("real read-only panel");
  receipt.catalog = panel.providers.map((p) => ({ id: p.id, models: p.modelCatalog?.models, executionModels: p.models }));
  const selected = (await request<AgentProvider[]>("/settings/providers")).find((p) => p.driver?.instanceId === instance);
  assert.ok(selected && selected.driver?.available, "Explicit provider is unavailable; no substitute is allowed.");
  assert.equal(selected.enabled, false);
  const denied = await fetch(`${origin}/api/qa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: paper.id, question: "Must not run while disabled", providerId: selected.id, model, threadRevision: 0 }) });
  assert.ok(!denied.ok); checks.push("disabled execution rejected");
  await request(`/settings/providers/${encodeURIComponent(selected.id)}`, "PATCH", { enabled: true, defaultModel: model });
  await request("/settings/driver/refresh", "POST", {});
  assert.equal((await request<AgentProvider[]>("/settings/providers")).find((p) => p.id === selected.id)?.defaultModel, model);
  checks.push("refresh preserves explicit model");
  console.log(JSON.stringify({ status: "ready", origin, root, paperId: paper.id, manuscriptId: document.id }));
  if (process.argv.includes("--generate")) {
    validGrant();
    const answer = await request<QaResponse>("/qa", "POST", { paperId: paper.id, question: "In two sentences, what effect does the position of relevant information have? Preserve the qualification 'often'.", providerId: selected.id, model, threadRevision: 0 });
    receipt.answer = answer; save();
    assert.equal(answer.status, "answered"); assert.ok(answer.evidence.length > 0);
    assert.ok(answer.evidence.every((e) => e.paperId === paper.id));
    assert.equal(repo.readMarkdown(paper.id), markdown); checks.push("real evidence-backed Q&A");
    validGrant();
    const selection = { paperIds: [paper.id], attachmentIds: [], manuscriptPaths: [] };
    const context = await request<WritingContext>(`/manuscripts/${document.id}/context`, "POST", selection);
    const batch = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates`, "POST", {
      requestId: randomUUID(), path: file.path, expectedRevision: file.revision, from: file.content.length, to: file.content.length,
      instruction: "Write two cautious sentences about the positional limitation described in the selected reading notes. Preserve 'often'; do not invent numerical results.", audience: 2,
      targets: [{ providerId: selected.id, model, count: 1 }],
      assistant: { action: "draft", context: selection, expectedContextRevision: context.revision, wordBudget: 60, jargon: "define", math: "conceptual", language: "English", style: "" },
    });
    let current = batch;
    while (current.candidates.some((candidate) => ["queued", "running"].includes(candidate.status))) {
      assert.ok(!stopping && backend.exitCode === null, "App stopped during writing; do not resubmit an uncertain request.");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates/${batch.id}`);
    }
    receipt.writing = current; save();
    assert.equal(current.candidates[0]?.status, "completed");
    assert.equal(current.candidates[0]?.review?.supported, true);
    assert.deepEqual(manuscripts.read(document.id), document); checks.push("real writing draft remains unaccepted");
  }
  const eventsRoot = path.join(research, ".litagent/cache/provider-runs");
  const completions: unknown[] = [];
  function readCompletions(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) readCompletions(name);
      else if (entry.name.endsWith(".events.jsonl")) {
        for (const line of fs.readFileSync(name, "utf8").trim().split("\n").filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === "run.completed") completions.push({ appRunId: event.runId, sdkRunId: event.payload.sdkRunId, usage: event.payload.usage, sources: event.payload.sources });
        }
      }
    }
  }
  if (fs.existsSync(eventsRoot)) readCompletions(eventsRoot);
  receipt.completions = completions;
  receipt.status = "passed"; save();
  console.log(JSON.stringify({ origin, root, receipt: path.join(root, "receipt.json"), checks }));
  if (process.argv.includes("--keep-open")) await exited;
} catch (error) {
  receipt.status = "failed"; save(); throw error;
} finally {
  stop(); await exited; log.end();
}
