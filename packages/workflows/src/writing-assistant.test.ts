import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import type { ProviderRunStartInput } from "@litagent/agents";
import type { CreateWritingCandidates, WritingAction, WritingAssistantOutput } from "@litagent/contracts";
import { WritingContextService } from "./writing-context";
import { WritingCandidateService } from "./writing-candidates";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-assistant-")); roots.push(root);
  const repo = new LitAgentRepository(root); repo.init();
  const paper = repo.importPaper({ metadata: { title: "Synthetic controlled study", authors: ["Example Author"], year: 2026 } }).paper;
  repo.writeMarkdown(paper.id, "# Results\n\nAccuracy was 0.72 on the synthetic held-out test set.\n");
  const store = new ManuscriptStore(root), document = store.create({ name: "Draft" });
  const file = document.files.find((file) => file.path === "sections/introduction.tex")!;
  const context = new WritingContextService(store, repo);
  const selection = { paperIds: [paper.id], attachmentIds: [], manuscriptPaths: [] };
  const preview = context.preview(document.id, selection);
  const source = preview.sources[0]!;
  let output: WritingAssistantOutput = { text: `Accuracy was 0.72. [[cite:${source.id}]]`, claims: [{ text: "Accuracy was 0.72.", kind: "reported", evidence: [{ sourceId: source.id, quote: "Accuracy was 0.72 on the synthetic held-out test set." }] }], warnings: ["Synthetic study only."] };
  let supported = true;
  let gate: (() => Promise<void>) | undefined;
  const runtime = {
    startRun: vi.fn((input: ProviderRunStartInput & { providerId: string }) => ({ id: "fixture", runId: input.runId, providerId: input.providerId, cwd: input.cwd, prompt: input.prompt,
      status: "running" as const, process: null, events: new EventEmitter(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      finished: (async () => {
        if (gate) await gate();
        const reviewing = input.prompt.startsWith("LitAgent writing source review");
        const value = reviewing ? { supported, reason: supported ? "Fixture review supports the exact selected claim." : "The claimed number is not supported.", claims: output.claims.map((_, index) => ({ index, supported, reason: "Fixture claim review." })) } : output;
        return { sessionId: "fixture", runId: input.runId, providerId: input.providerId, status: "completed" as const, exitCode: 0, signal: null, failureClass: null, transcript: JSON.stringify(value), events: [], artifacts: [] };
      })()
    })), cancelRun: vi.fn()
  };
  const service = new WritingCandidateService(store, runtime, () => {}, context);
  const request = (action: WritingAction = "draft"): CreateWritingCandidates => ({ requestId: randomUUID(), path: file.path, expectedRevision: file.revision, from: file.content.length, to: file.content.length,
    instruction: "Explain the result without overstating it.", audience: 3, targets: [{ providerId: "driver.fixture", model: "synthetic", count: 1 }],
    assistant: { action, context: selection, expectedContextRevision: preview.revision, wordBudget: 150, jargon: "define", math: "conceptual", language: "English", style: "Use cautious claims." } });
  return { root, repo, paper, store, document, file, preview, source, runtime, service, request, setOutput: (value: WritingAssistantOutput) => { output = value; }, rejectReview: () => { supported = false; }, hold: (value: () => Promise<void>) => { gate = value; } };
}

it("drafts at the cursor, reviews exact evidence, inserts bibliography explicitly and retains history", async () => {
  const f = fixture(), input = f.request();
  const started = f.service.start(f.document.id, input); await f.service.idle();
  const batch = f.service.get(f.document.id, started.id), candidate = batch.candidates[0]!;
  expect(candidate.text).toContain(`\\cite{${f.source.citekey}}`);
  expect(candidate.review?.supported).toBe(true);
  expect(candidate.editorial).toMatchObject({ wordCount: 3, targetWords: 150 });
  expect(f.runtime.startRun).toHaveBeenCalledTimes(2);
  expect(f.runtime.startRun.mock.calls[0]![0].prompt).toContain("Use cautious claims.");
  expect(f.runtime.startRun.mock.calls[1]![0].prompt).toContain("code used as evidence of measured performance");
  expect(f.runtime.startRun.mock.calls[1]![0].prompt).toContain("Do not count words");
  expect(f.runtime.startRun.mock.calls[1]![0].prompt).not.toContain(input.instruction);
  expect(f.store.read(f.document.id).files.find((file) => file.path === f.file.path)).toEqual(f.file);
  const acceptance = { candidateId: candidate.id, expectedRevision: f.file.revision };
  expect(() => f.service.accept(f.document.id, batch.id, acceptance)).toThrow(/bibliography/);
  const bib = f.document.files.find((file) => file.path === "references.bib")!;
  const saved = f.service.addReferences(f.document.id, batch.id, candidate.id, { path: bib.path, expectedRevision: bib.revision });
  expect(saved.content).toContain(f.source.bibliography);
  expect(f.service.addReferences(f.document.id, batch.id, candidate.id, { path: bib.path, expectedRevision: saved.revision })).toEqual(saved);
  expect(f.service.evidence(f.document.id, batch.id, f.source.id, candidate.claims![0]!.evidence[0]!.quote)).toMatchObject({ startLine: 3, endLine: 3, kind: "literature" });
  const result = f.service.accept(f.document.id, batch.id, acceptance);
  expect(result.content).toBe(f.file.content + candidate.text);
  expect(f.service.accept(f.document.id, batch.id, acceptance)).toEqual(result);
  expect(f.store.history(f.document.id, f.file.path)[0]?.reason).toBe("candidate");
});

it("blocks credential-bearing selection or surrounding context before any model call", () => {
  const f = fixture();
  const file = f.store.writeFile(f.document.id, { path: f.file.path, expectedRevision: f.file.revision, content: 'Some prose.\n% api_key = "not-a-real-secret-but-sensitive"\n' });
  const request = { ...f.request(), expectedRevision: file.revision, from: 0, to: 11 };
  expect(() => f.service.start(f.document.id, request)).toThrow(/credentials/);
  expect(f.runtime.startRun).not.toHaveBeenCalled();
  expect(f.store.candidateBatches(f.document.id)).toEqual([]);
});

it("rejects fabricated evidence/quotes and unselected citation keys before review", async () => {
  for (const change of ["quote", "source", "citekey"] as const) {
    const f = fixture();
    f.setOutput({ text: change === "citekey" ? "Claim \\cite{imaginary}" : `Claim [[cite:${f.source.id}]]`, claims: [{ text: "Claim", kind: "reported", evidence: [{ sourceId: change === "source" ? `ws_${"f".repeat(24)}` : f.source.id, quote: change === "quote" ? "An invented quotation" : "Accuracy was 0.72" }] }], warnings: [] });
    const batch = f.service.start(f.document.id, f.request()); await f.service.idle();
    expect(f.service.get(f.document.id, batch.id).candidates[0]).toMatchObject({ status: "failed", text: null });
    expect(f.runtime.startRun).toHaveBeenCalledTimes(1);
  }
});

it("retains a rejected semantic review for inspection but blocks acceptance", async () => {
  const f = fixture(); f.rejectReview();
  const batch = f.service.start(f.document.id, f.request()); await f.service.idle();
  const candidate = f.service.get(f.document.id, batch.id).candidates[0]!;
  expect(candidate).toMatchObject({ status: "completed", review: { supported: false } });
  expect(() => f.service.accept(f.document.id, batch.id, { candidateId: candidate.id, expectedRevision: f.file.revision })).toThrow(/unsupported/);
  expect(f.store.read(f.document.id).files.find((file) => file.path === f.file.path)).toEqual(f.file);
});

it("blocks stale context before dispatch and after generation, including citation display", async () => {
  const f = fixture(); const batch = f.service.start(f.document.id, f.request()); await f.service.idle();
  f.repo.writeMarkdown(f.paper.id, "Different source data");
  expect(() => f.service.start(f.document.id, f.request())).toThrow(/Sources changed/);
  expect(f.service.get(f.document.id, batch.id).sourceIssue).toMatch(/Sources changed/);
  expect(() => f.service.evidence(f.document.id, batch.id, f.source.id, "Accuracy was 0.72")).toThrow(/sources changed/);
  expect(() => f.service.accept(f.document.id, batch.id, { candidateId: batch.candidates[0]!.id, expectedRevision: f.file.revision })).toThrow(/sources changed/);
});

it("supports planning without evidence, keeps review reports non-applicable and persists rejection", async () => {
  for (const action of ["outline", "storyline", "review"] as const) {
    const f = fixture();
    f.setOutput({ text: "\\section{Evaluation}\n% TODO: collect measurements and define protocol.\n", claims: [], warnings: ["No results supplied."] });
    const input = f.request(action);
    const batch = f.service.start(f.document.id, input); await f.service.idle();
    const acceptance = { candidateId: batch.candidates[0]!.id, expectedRevision: f.file.revision };
    if (action === "review") expect(() => f.service.accept(f.document.id, batch.id, acceptance)).toThrow(/review-only/);
    else {
      f.service.dismiss(f.document.id, batch.id, acceptance.candidateId, true);
      expect(() => f.service.accept(f.document.id, batch.id, acceptance)).toThrow(/dismissed/);
      f.service.dismiss(f.document.id, batch.id, acceptance.candidateId, false);
      expect(f.service.accept(f.document.id, batch.id, acceptance).content).toContain("TODO");
    }
  }
});

it("cancels the separate review and ignores late review completion without applying text", async () => {
  const f = fixture(); let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0; f.hold(async () => { if (++calls === 2) await wait; });
  const batch = f.service.start(f.document.id, f.request());
  await vi.waitFor(() => expect(f.runtime.startRun).toHaveBeenCalledTimes(2));
  f.service.cancel(f.document.id, batch.id); release(); await f.service.idle();
  expect(f.runtime.cancelRun).toHaveBeenCalledWith(`${batch.candidates[0]!.id}_review`);
  expect(f.service.get(f.document.id, batch.id).candidates[0]!.status).toBe("cancelled");
  expect(f.store.read(f.document.id).files.find((file) => file.path === f.file.path)).toEqual(f.file);
});

it("never overwrites a conflicting bibliography entry or a newer manual edit", async () => {
  const f = fixture(); const batch = f.service.start(f.document.id, f.request()); await f.service.idle();
  const bib = f.document.files.find((file) => file.path === "references.bib")!;
  const changed = f.store.writeFile(f.document.id, { path: bib.path, expectedRevision: bib.revision, content: `@article{${f.source.citekey}, title={Unrelated}}` });
  expect(() => f.service.addReferences(f.document.id, batch.id, batch.candidates[0]!.id, { path: bib.path, expectedRevision: changed.revision })).toThrow(/citekey/);
  f.store.writeFile(f.document.id, { path: f.file.path, expectedRevision: f.file.revision, content: "New manual draft" });
  expect(() => f.service.accept(f.document.id, batch.id, { candidateId: batch.candidates[0]!.id, expectedRevision: f.file.revision })).toThrow(/changed after generation/);
});
