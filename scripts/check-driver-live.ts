import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const rc = process.argv.includes("--rc");
const fullMarkdown = process.env.LITAGENT_LIVE_MARKDOWN;
const fullPdf = process.env.LITAGENT_LIVE_PDF;
if (rc) assert.ok(fullMarkdown && fullPdf && process.argv.includes("--generate"), "RC checks require explicit public Markdown/PDF paths and --generate.");
assert.ok(profilePath && instance && model, "Set LITAGENT_LIVE_PROFILE, LITAGENT_LIVE_PROVIDER and LITAGENT_LIVE_MODEL explicitly.");
const profile = await readConnectionProfile(profilePath);
const validGrant = () => assert.ok(Date.parse(profile.expiresAt) > Date.now(), "Validation grant expired; request renewal, never fall back.");
validGrant();
const resumeRoot = process.env.LITAGENT_LIVE_RESUME_FAILED_WRITING;
if (resumeRoot) assert.ok(rc && path.dirname(fs.realpathSync(resumeRoot)) === fs.realpathSync(os.tmpdir()) && path.basename(resumeRoot).startsWith("litagent-alpha6-live-"), "Only a disposable live-check repository may be resumed.");
const previous = resumeRoot ? JSON.parse(fs.readFileSync(path.join(resumeRoot, "receipt.json"), "utf8")) : null;
if (previous) {
  assert.ok(previous.status === "failed" && previous.answer?.status === "answered" && previous.writing?.candidates.every((candidate: { status: string }) => candidate.status === "failed") && !previous.writing.accepted && !previous.writing.accepting, "Only failed, unapplied writing may be retried; never resubmit uncertain work.");
  assert.equal(previous.provider, instance); assert.equal(previous.model, model); assert.equal(previous.endpoint, profile.url);
}
const root = resumeRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "litagent-alpha6-live-"));
fs.chmodSync(root, 0o700);
const research = path.join(root, "research");
const repo = new LitAgentRepository(research); repo.init();
const project = previous ? repo.readProject(previous.projectId)! : rc ? repo.createProject({ name: "Disposable RC full-paper acceptance", researchQuestion: "How does additional retrieved context affect question answering?" }) : null;
const paper = repo.importPaper({ ...(project ? { projectId: project.id } : {}), ...(rc ? { sourcePath: fullPdf! } : {}), metadata: { title: rc ? "Lost in the Middle: How Language Models Use Long Contexts" : "Lost in the Middle: public abstract reading notes", authors: ["Nelson F. Liu et al."], year: 2023, arxivId: "2307.03172" } }).paper;
const markdown = rc ? fs.readFileSync(fullMarkdown!, "utf8") : "# Public abstract reading notes\n\nSource: https://arxiv.org/abs/2307.03172v3\n\nThese notes paraphrase the abstract, not the full paper.\n\n## Findings\n\nThe study evaluates multi-document question answering and key-value retrieval. Model performance is often better when relevant information is near the beginning or end of the input. Accessing information in the middle of long contexts leads to a substantial drop, including for models designed for long contexts. These findings do not mean that every tested model fails on every long-context example.\n";
if (previous) assert.equal(repo.readMarkdown(paper.id), markdown); else repo.writeMarkdown(paper.id, markdown);
const manuscripts = new ManuscriptStore(research);
const document = previous ? manuscripts.read(previous.manuscriptId) : manuscripts.create({ name: "Public long-context writing check", projectIds: project ? [project.id] : [] });
const file = document.files.find((entry) => entry.path === "sections/introduction.tex")!;
const reservation = http.createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const cwd = fileURLToPath(new URL("../", import.meta.url));
const log = fs.createWriteStream(path.join(root, "backend.log"), { mode: 0o600 });
function startBackend() {
const child = spawn(process.execPath, ["--import", "tsx", "apps/server/src/index.ts"], {
  cwd, env: { ...process.env, LITAGENT_REPO: research, LITAGENT_PORT: String(port), AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
return child;
}
let backend = startBackend();
let exited = new Promise<void>((resolve) => backend.once("exit", () => resolve()));
const origin = `http://127.0.0.1:${port}`;
async function request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${route}`, { method, headers: { "Content-Type": "application/json", "X-LitAgent-Local": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${route} failed (${response.status}); inspect the private receipt directory.`);
  return response.json() as Promise<T>;
}
const receipt: Record<string, unknown> = { sdk: "0.2.0-alpha.6", provider: instance, model, endpoint: profile.url, projectId: project?.id, paperId: paper.id, manuscriptId: document.id, markdownSha256: createHash("sha256").update(markdown).digest("hex"), markdownCharacters: markdown.length, ...(rc ? { pdfSha256: createHash("sha256").update(fs.readFileSync(fullPdf!)).digest("hex") } : {}), checks: [] };
if (previous) receipt.previousAttempt = previous;
const checks = receipt.checks as string[];
const save = () => fs.writeFileSync(path.join(root, "receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
let stopping = false;
const stop = () => { stopping = true; backend.kill("SIGTERM"); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
async function waitReady() {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.ok(backend.exitCode === null && !stopping, "Isolated app stopped before startup.");
    try { if ((await fetch(`${origin}/api/projects`)).ok) { ready = true; break; } } catch { /* Bounded app startup only, not model execution. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "App startup failed.");
}
async function restart() {
  backend.kill("SIGTERM"); await exited;
  backend = startBackend(); exited = new Promise<void>((resolve) => backend.once("exit", () => resolve()));
  await waitReady();
}
try {
  await waitReady();
  if (!previous) {
  const empty = await request<ProviderPanelState>("/settings/driver/panel", "POST", { action: "snapshot" });
  assert.equal(empty.connected, false); assert.equal(empty.providers.length, 0); checks.push("empty onboarding");
  await request("/settings/driver", "PUT", { url: profile.url, tokenFile: path.resolve(path.dirname(profilePath), profile.tokenFile), label: "Prometheus alpha.6 validation", deviceName: "Prometheus" });
  }
  const panel = await request<ProviderPanelState>("/settings/driver/panel", "POST", { action: "snapshot", refresh: true });
  assert.equal(panel.connected, true); assert.equal(panel.management, undefined); checks.push("real read-only panel");
  receipt.catalog = panel.providers.map((p) => ({ id: p.id, models: p.modelCatalog?.models, executionModels: p.models }));
  const selected = (await request<AgentProvider[]>("/settings/providers")).find((p) => p.driver?.instanceId === instance);
  assert.ok(selected && selected.driver?.available, "Explicit provider is unavailable; no substitute is allowed.");
  if (!previous) {
  assert.equal(selected.enabled, false);
  const denied = await fetch(`${origin}/api/qa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId: paper.id, question: "Must not run while disabled", providerId: selected.id, model, threadRevision: 0 }) });
  assert.ok(!denied.ok); checks.push("disabled execution rejected");
  await request(`/settings/providers/${encodeURIComponent(selected.id)}`, "PATCH", { enabled: true, defaultModel: model });
  }
  await request("/settings/driver/refresh", "POST", {});
  assert.equal((await request<AgentProvider[]>("/settings/providers")).find((p) => p.id === selected.id)?.defaultModel, model);
  checks.push("refresh preserves explicit model");
  console.log(JSON.stringify({ status: "ready", origin, root, paperId: paper.id, manuscriptId: document.id }));
  if (process.argv.includes("--generate")) {
    validGrant();
    if (rc) {
      const hits = await request<Array<{ paper: { id: string }; passage?: { id: string } }>>("/search", "POST", { query: "retriever recall", projectId: project!.id, paperIds: [paper.id] });
      assert.ok(hits.some((hit) => hit.paper.id === paper.id && hit.passage));
      receipt.retrieval = hits; checks.push("full-paper selected-scope passage retrieval");
    }
    const answer: QaResponse = previous?.answer ?? await request<QaResponse>("/qa", "POST", { paperId: paper.id, question: rc ? "According to section 5, why does retrieving more documents not necessarily improve open-domain QA? Give two sentences and include the 20 versus 50 document comparison." : "In two sentences, what effect does the position of relevant information have? Preserve the qualification 'often'.", providerId: selected.id, model, threadRevision: 0 });
    receipt.answer = answer; save();
    assert.equal(answer.status, "answered"); assert.ok(answer.evidence.length > 0);
    assert.ok(answer.evidence.every((e) => e.paperId === paper.id));
    if (rc) for (const evidence of answer.evidence) {
      assert.ok(evidence.passageId);
      const target = await request<{ markdown: { available: boolean }; pdf: { available: boolean } }>(`/papers/${paper.id}/passages/${evidence.passageId}/target?projectId=${project!.id}`);
      assert.equal(target.markdown.available, true); assert.equal(target.pdf.available, true);
    }
    assert.equal(repo.readMarkdown(paper.id), markdown); checks.push("real evidence-backed Q&A");
    validGrant();
    const selection = { paperIds: [paper.id], attachmentIds: [], manuscriptPaths: [] };
    const context = await request<WritingContext>(`/manuscripts/${document.id}/context`, "POST", selection);
    if (rc) assert.ok(context.coverage.every((item) => item.status === "complete"), "Do not claim full-paper coverage for truncated context.");
    const batch = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates`, "POST", {
      requestId: randomUUID(), path: file.path, expectedRevision: file.revision, from: file.content.length, to: file.content.length,
      instruction: rc ? "Write two cautious sentences summarizing section 5's open-domain QA finding: increasing retrieved documents from 20 to 50 has limited benefit. Cite exact supporting passages and preserve the numerical qualifications." : "Write two cautious sentences about the positional limitation described in the selected reading notes. Preserve 'often'; do not invent numerical results.", audience: 2,
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
    if (rc) {
      const candidate = current.candidates[0]!;
      for (const evidence of candidate.claims!.flatMap((claim) => claim.evidence)) {
        const resolved = await request<{ quote: string }>(`/manuscripts/${document.id}/candidates/${batch.id}/evidence`, "POST", evidence);
        assert.equal(resolved.quote, evidence.quote);
      }
      const bibliography = manuscripts.read(document.id).files.find((item) => item.path.endsWith(".bib"));
      await request(`/manuscripts/${document.id}/candidates/${batch.id}/references/${candidate.id}`, "POST", { path: bibliography?.path ?? "references.bib", expectedRevision: bibliography?.revision ?? null });
      const acceptance = { candidateId: candidate.id, expectedRevision: file.revision };
      const accepted = await request(`/manuscripts/${document.id}/candidates/${batch.id}/accept`, "POST", acceptance);
      const history = manuscripts.history(document.id, file.path);
      await restart();
      assert.deepEqual(await request(`/manuscripts/${document.id}/candidates/${batch.id}/accept`, "POST", acceptance), accepted);
      assert.deepEqual(manuscripts.history(document.id, file.path), history);
      assert.deepEqual(await request(`/manuscripts/${document.id}/candidates`, "POST", batch.request), await request(`/manuscripts/${document.id}/candidates/${batch.id}`));
      receipt.accepted = accepted; checks.push("accepted supported draft once across restart and request replay"); save();
      // These are distinct, explicitly authorized requests, never retries of an
      // uncertain generation. Cancellation is tested before abrupt disconnect.
      for (const mode of ["cancel", "disconnect"] as const) {
        validGrant();
        const saved = manuscripts.read(document.id).files.find((item) => item.path === file.path)!;
        const pending = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates`, "POST", {
          requestId: randomUUID(), path: file.path, expectedRevision: saved.revision,
          from: batch.request.from, to: batch.request.from + candidate.text!.length,
          instruction: "Make this paragraph slightly clearer without adding claims. Preserve every citation and numerical qualification.", audience: 2,
          targets: [{ providerId: selected.id, model, count: mode === "disconnect" ? 2 : 1 }],
        });
        const eventsPath = path.join(research, ".litagent/cache/provider-runs", pending.candidates[0]!.id, "draft.events.jsonl");
        let sdkRunId: string | undefined;
        while (!sdkRunId) {
          const events = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
          sdkRunId = events.find((event) => event.payload?.sdkRunId)?.payload.sdkRunId;
          assert.ok(!events.some((event) => ["run.completed", "run.failed", "run.cancelled"].includes(event.type)), "Request ended before interruption; inspect receipt instead of looping new model calls.");
          assert.ok(backend.exitCode === null && !stopping);
          if (!sdkRunId) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        receipt[mode] = { batchId: pending.id, candidateId: pending.candidates[0]!.id, sdkRunId }; save();
        if (mode === "cancel") {
          const cancelled = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates/${pending.id}/cancel`, "POST", {});
          assert.equal(cancelled.status, "cancelled");
          // Wait for the actual normalized terminal event, not merely the local button state.
          while (!fs.readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).some((event) => ["run.cancelled", "run.completed", "run.failed"].includes(event.type)))
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const beforeRestart = fs.readFileSync(eventsPath, "utf8");
        await restart();
        const recovered = await request<WritingCandidateBatch>(`/manuscripts/${document.id}/candidates/${pending.id}`);
        assert.equal(recovered.status, mode === "cancel" ? "cancelled" : "interrupted");
        assert.ok(recovered.candidates.every((item) => item.status === recovered.status));
        assert.deepEqual(await request(`/manuscripts/${document.id}/candidates`, "POST", pending.request), recovered);
        assert.equal(fs.readFileSync(eventsPath, "utf8"), beforeRestart);
        for (const queued of pending.candidates.slice(1)) assert.equal(fs.existsSync(path.join(research, ".litagent/cache/provider-runs", queued.id)), false);
        assert.deepEqual(manuscripts.read(document.id).files.find((item) => item.path === file.path), saved);
        assert.deepEqual(manuscripts.history(document.id, file.path).filter((item) => item.reason === "candidate"), history.filter((item) => item.reason === "candidate"));
        checks.push(`${mode} survives restart without replay or duplicate accepted effects`); save();
      }
    }
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
