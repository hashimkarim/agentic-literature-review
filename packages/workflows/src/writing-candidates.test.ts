import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentHarness, ProviderRunResult, ProviderRunStartInput } from "@litagent/agents";
import { AgentProviderCatalog } from "@litagent/agents";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import type { CreateWritingCandidates } from "@litagent/contracts";
import { WritingCandidateService, writingTargetValidator } from "./writing-candidates";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
const completed = (text: string): ProviderRunResult => ({ sessionId: "fixture", runId: "fixture", providerId: "driver.fixture", status: "completed", exitCode: 0, signal: null, failureClass: null, transcript: JSON.stringify({ text }), events: [], artifacts: [] });
function fixture(result: (input: ProviderRunStartInput) => Promise<ProviderRunResult> = async (input) => completed(`Alternative from ${input.model}`)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-candidates-")); roots.push(root);
  const repo = new LitAgentRepository(root); repo.init();
  const projectId = repo.createProject({ name: "Synthetic writing" }).id;
  const store = new ManuscriptStore(root);
  const document = store.create(projectId, { name: "Synthetic manuscript" });
  const initial = document.files.find((file) => file.path === "main.tex")!;
  const main = store.writeFile(projectId, document.id, { path: initial.path, content: "Before. A measured result with uncertainty. After.", expectedRevision: initial.revision });
  const runtime: Pick<AgentHarness, "startRun" | "cancelRun"> = {
    startRun: vi.fn((input: ProviderRunStartInput & { providerId: string }) => ({ id: randomUUID(), runId: input.runId, providerId: input.providerId, cwd: input.cwd, prompt: input.prompt,
      status: "running" as const, process: null, events: new EventEmitter(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finished: result(input) })),
    cancelRun: vi.fn()
  };
  const validate = vi.fn();
  const service = new WritingCandidateService(store, runtime, validate);
  const input: CreateWritingCandidates = { requestId: randomUUID(), path: main.path, expectedRevision: main.revision, from: 8, to: 42,
    instruction: "Make the wording clearer.", audience: 2, targets: [{ providerId: "driver.one", model: "first", count: 2 }, { providerId: "driver.two", model: "second", count: 1 }] };
  return { root, repo, store, projectId, id: document.id, main, runtime, validate, service, input };
}

it("generates independent same-model and multi-model drafts without changing source", async () => {
  const f = fixture();
  const batch = f.service.start(f.projectId, f.id, f.input);
  expect(batch.selectedText).toBe(f.main.content.slice(8, 42));
  expect(batch.contextBefore).toBe("Before. ");
  await f.service.idle();
  const saved = f.service.get(f.projectId, f.id, batch.id);
  expect(saved.candidates.map((item) => [item.model, item.variant, item.status])).toEqual([["first", 1, "completed"], ["first", 2, "completed"], ["second", 1, "completed"]]);
  expect(f.store.read(f.projectId, f.id).files.find((file) => file.path === "main.tex")).toEqual(f.main);
  const calls = vi.mocked(f.runtime.startRun).mock.calls;
  expect(calls[0]?.[0].prompt).toContain("not research or fact verification");
  expect(calls[0]?.[0].prompt).toContain("A measured result with uncertainty");
  expect(calls[1]?.[0].prompt).toContain("Alternative number: 2");
  expect(calls.every(([input]) => !input.outputPath && !input.artifactPaths)).toBe(true);
});

it("deduplicates retries by request ID before and after restart; changed requests conflict", async () => {
  const f = fixture();
  const batch = f.service.start(f.projectId, f.id, f.input);
  expect(f.service.start(f.projectId, f.id, f.input).id).toBe(batch.id);
  await f.service.idle();
  const restarted = new WritingCandidateService(new ManuscriptStore(f.root), f.runtime, f.validate);
  expect(restarted.start(f.projectId, f.id, f.input).status).toBe("completed");
  expect(f.runtime.startRun).toHaveBeenCalledTimes(3);
  expect(() => restarted.start(f.projectId, f.id, { ...f.input, instruction: "Different" })).toThrow(/request ID/);
});

it("keeps successful candidates after partial failure and never publishes malformed output", async () => {
  let call = 0;
  const f = fixture(async () => {
    if (++call === 1) return completed("Valid first draft");
    if (call === 2) return { ...completed(""), transcript: "raw provider secret-like diagnostic" };
    return { ...completed("ignored partial text"), status: "failed", failureClass: "auth" };
  });
  const batch = f.service.start(f.projectId, f.id, f.input); await f.service.idle();
  const saved = f.service.get(f.projectId, f.id, batch.id);
  expect(saved.candidates.map((candidate) => candidate.status)).toEqual(["completed", "failed", "failed"]);
  expect(JSON.stringify(saved)).not.toContain("secret-like");
  expect(JSON.stringify(saved)).not.toContain("ignored partial");
});

it("accepts only an explicit candidate, preserves alternatives and records history", async () => {
  const f = fixture(); const batch = f.service.start(f.projectId, f.id, f.input); await f.service.idle();
  const chosen = batch.candidates[2]!;
  const accepted = f.service.accept(f.projectId, f.id, batch.id, { candidateId: chosen.id, expectedRevision: f.main.revision });
  expect(accepted.content).toBe(f.main.content.slice(0, 8) + "Alternative from second" + f.main.content.slice(42));
  expect(f.service.get(f.projectId, f.id, batch.id).candidates).toHaveLength(3);
  expect(f.store.history(f.projectId, f.id, f.main.path)[0]?.reason).toBe("candidate");
  expect(f.service.accept(f.projectId, f.id, batch.id, { candidateId: chosen.id, expectedRevision: f.main.revision })).toEqual(accepted);
  expect(() => f.service.accept(f.projectId, f.id, batch.id, { candidateId: batch.candidates[0]!.id, expectedRevision: f.main.revision })).toThrow(/already selected/);
  f.store.writeFile(f.projectId, f.id, { path: f.main.path, content: f.main.content, expectedRevision: accepted.revision });
  expect(() => f.service.accept(f.projectId, f.id, batch.id, { candidateId: chosen.id, expectedRevision: f.main.revision })).toThrow(/since changed/);
});

it("rejects candidates against concurrent edits and keeps both versions", async () => {
  const f = fixture(); const batch = f.service.start(f.projectId, f.id, f.input); await f.service.idle();
  f.store.writeFile(f.projectId, f.id, { path: f.main.path, content: "New manual edit", expectedRevision: f.main.revision });
  expect(() => f.service.accept(f.projectId, f.id, batch.id, { candidateId: batch.candidates[0]!.id, expectedRevision: f.main.revision })).toThrow(/changed after generation/);
  expect(f.store.read(f.projectId, f.id).files.find((file) => file.path === f.main.path)?.content).toBe("New manual edit");
  expect(f.service.get(f.projectId, f.id, batch.id).accepted).toBeNull();
});

it("recovers an interrupted acceptance without applying a replacement twice", async () => {
  const f = fixture(); const batch = f.service.start(f.projectId, f.id, f.input); await f.service.idle();
  const save = f.store.saveCandidateBatch.bind(f.store);
  vi.spyOn(f.store, "saveCandidateBatch").mockImplementationOnce(save).mockImplementationOnce(() => { throw new Error("Disk full after file save"); }).mockImplementation(save);
  const request = { candidateId: batch.candidates[0]!.id, expectedRevision: f.main.revision };
  expect(() => f.service.accept(f.projectId, f.id, batch.id, request)).toThrow(/Disk full/);
  const before = f.store.read(f.projectId, f.id).files.find((file) => file.path === f.main.path)!;
  expect(f.service.accept(f.projectId, f.id, batch.id, request)).toEqual(before);
  expect(f.service.get(f.projectId, f.id, batch.id).accepted?.candidateId).toBe(request.candidateId);
  expect(f.store.history(f.projectId, f.id, f.main.path).filter((entry) => entry.reason === "candidate")).toHaveLength(1);
});

it("cancels active and queued work, ignores late output and does not start more calls", async () => {
  let finish!: (result: ProviderRunResult) => void;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const batch = f.service.start(f.projectId, f.id, f.input);
  await Promise.resolve();
  f.service.cancel(f.projectId, f.id, batch.id);
  expect(f.runtime.cancelRun).toHaveBeenCalledWith(batch.candidates[0]!.id);
  finish(completed("Late result")); await f.service.idle();
  expect(f.runtime.startRun).toHaveBeenCalledTimes(1);
  expect(f.service.get(f.projectId, f.id, batch.id).candidates.every((candidate) => candidate.status === "cancelled" && candidate.text === null)).toBe(true);
});

it("reconciles a restart as interrupted, without replaying started or queued model calls", async () => {
  const f = fixture(); const batch = f.service.start(f.projectId, f.id, f.input); await f.service.idle();
  const stored = f.service.get(f.projectId, f.id, batch.id);
  stored.status = "running"; stored.candidates[1]!.status = "running"; stored.candidates[1]!.text = null;
  stored.candidates[2]!.status = "queued"; stored.candidates[2]!.text = null;
  f.store.saveCandidateBatch(stored);
  const restarted = new WritingCandidateService(f.store, f.runtime, f.validate);
  expect(restarted.list(f.projectId, f.id)[0]?.status).toBe("interrupted");
  expect(restarted.get(f.projectId, f.id, batch.id).candidates.map((candidate) => candidate.status)).toEqual(["completed", "interrupted", "interrupted"]);
  expect(f.runtime.startRun).toHaveBeenCalledTimes(3);
});

it("enforces bounds, scope and explicit targets before starting any model work", () => {
  const f = fixture();
  for (const input of [{ ...f.input, expectedRevision: "0".repeat(64) }, { ...f.input, to: 8001 }, { ...f.input, targets: [{ providerId: "codex", model: "first", count: 1 }] }]) {
    expect(() => f.service.start(f.projectId, f.id, input)).toThrow();
  }
  f.validate.mockImplementation(() => { throw new Error("Connection disabled"); });
  expect(() => f.service.start(f.projectId, f.id, f.input)).toThrow(/disabled/);
  expect(f.runtime.startRun).not.toHaveBeenCalled();
  const other = f.repo.createProject({ name: "Other" });
  expect(() => f.service.list(other.id, f.id)).toThrow(/not found/);
});

it("rejects disabled, unknown and non-SDK targets without probing or falling back", () => {
  const catalog = new AgentProviderCatalog([]);
  vi.spyOn(catalog, "definition").mockReturnValue({ id: "driver.fixture", label: "Fixture", models: ["allowed"], command: "", versionArgs: [], capabilities: [], runArgs: () => [], connectCommand: "", defaultModel: null });
  const config = { providerId: "driver.fixture", enabled: true, connected: false, command: "", defaultModel: null, customModels: ["custom"], lastCheckedAt: null, updatedAt: new Date().toISOString() };
  const validate = writingTargetValidator(catalog, () => ({ "driver.fixture": config }));
  validate({ providerId: "driver.fixture", model: "allowed", count: 1 });
  validate({ providerId: "driver.fixture", model: "custom", count: 1 });
  expect(() => validate({ providerId: "driver.fixture", model: "different", count: 1 })).toThrow(/catalog/);
  config.enabled = false;
  expect(() => validate({ providerId: "driver.fixture", model: "allowed", count: 1 })).toThrow(/enabled/);
  expect(() => validate({ providerId: "codex", model: "allowed", count: 1 })).toThrow(/enabled/);
});
