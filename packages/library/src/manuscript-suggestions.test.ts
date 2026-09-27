import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ManuscriptStore } from "./manuscripts";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { force: true, recursive: true })); });
function fixture(replacement = "A more precise claim.") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "writing-suggestions-")); roots.push(root);
  const store = new ManuscriptStore(root), document = store.create({ name: "Synthetic suggestions" });
  const content = "Opening. A broad claim. Closing.";
  const file = store.writeFile(document.id, { path: "sections/review.tex", content, expectedRevision: null });
  const selection = { path: file.path, revision: file.revision, from: 9, to: 23, quote: "A broad claim." };
  const request = { requestId: randomUUID(), selection, body: "Make the claim precise.", replacement };
  const thread = store.createComment(document.id, request);
  const accept = { requestId: randomUUID(), expectedVersion: thread.version, expectedRevision: file.revision };
  return { root, store, document, file, selection, request, thread, accept, replacement };
}

it("stores a suggestion without editing source, accepts only explicitly, and records recoverable history", () => {
  const f = fixture();
  expect(f.store.read(f.document.id).files.find((file) => file.path === f.file.path)).toEqual(f.file);
  expect(new ManuscriptStore(f.root).comments(f.document.id)[0]?.suggestion).toEqual({ status: "pending", replacement: f.replacement });
  const accepted = f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept);
  expect(accepted.file.content).toBe("Opening. A more precise claim. Closing.");
  expect(accepted.comment).toMatchObject({ status: "resolved", version: 2, anchor: { quote: f.selection.quote }, suggestion: { status: "accepted", resultRevision: accepted.file.revision } });
  expect(accepted.comment.location).toBeNull();
  expect(f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept)).toEqual(accepted);
  const history = f.store.history(f.document.id, f.file.path);
  expect(history.map((entry) => entry.reason)).toEqual(["suggestion", "saved"]);
  expect(f.store.historicalFile(f.document.id, f.file.path, history[1]!.id)).toEqual(f.file);
  expect(f.store.restore(f.document.id, { path: f.file.path, versionId: history[1]!.id, expectedRevision: accepted.file.revision })).toEqual(f.file);
  // A late retry cannot put accepted text back after a deliberate restore.
  expect(f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept).file).toEqual(f.file);
});

it("supports deletion suggestions and rejects unchanged or oversized replacements", () => {
  const f = fixture("");
  expect(f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept).file.content).toBe("Opening.  Closing.");
  const g = fixture();
  expect(() => g.store.createComment(g.document.id, { ...g.request, requestId: randomUUID(), replacement: g.selection.quote })).toThrow(/must differ/);
  expect(() => g.store.createComment(g.document.id, { ...g.request, requestId: randomUUID(), replacement: "x".repeat(8001) })).toThrow();
});

it("rejects suggestions without changing text and cannot revive decided replacements", () => {
  const f = fixture();
  const input = { action: "reject-suggestion", requestId: randomUUID(), expectedVersion: 1 };
  const rejected = f.store.updateComment(f.document.id, f.thread.id, input);
  expect(rejected).toMatchObject({ status: "resolved", suggestion: { status: "rejected" } });
  expect(f.store.updateComment(f.document.id, f.thread.id, input)).toEqual(rejected);
  const reopened = f.store.updateComment(f.document.id, f.thread.id, { action: "reopen", expectedVersion: rejected.version, requestId: randomUUID() });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, { ...f.accept, expectedVersion: reopened.version })).toThrow(/no pending/);
  expect(() => f.store.updateComment(f.document.id, f.thread.id, { action: "reattach", selection: f.selection, expectedVersion: reopened.version, requestId: randomUUID() })).toThrow(/cannot be reattached/);
  expect(f.store.read(f.document.id).files.find((file) => file.path === f.file.path)).toEqual(f.file);
  expect(f.store.history(f.document.id, f.file.path)).toHaveLength(1);
});

it("requires current thread and exact source revisions even when a quote can be relocated", () => {
  const f = fixture();
  expect(() => f.store.updateComment(f.document.id, f.thread.id, { action: "resolve", expectedVersion: 1, requestId: randomUUID() })).toThrow(/Accept or reject/);
  const file = f.store.writeFile(f.document.id, { path: f.file.path, content: "New start. " + f.file.content, expectedRevision: f.file.revision });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept)).toThrow(/source changed/);
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, { ...f.accept, expectedRevision: file.revision })).toThrow(/source changed/);
  const reattached = f.store.updateComment(f.document.id, f.thread.id, { action: "reattach", expectedVersion: 1, requestId: randomUUID(), selection: { ...f.selection, revision: file.revision, from: 20, to: 34 } });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, { ...f.accept, expectedRevision: file.revision })).toThrow(/thread changed/);
  expect(f.store.acceptSuggestion(f.document.id, f.thread.id, { ...f.accept, expectedVersion: reattached.version, expectedRevision: file.revision }).file.content).toBe("New start. Opening. A more precise claim. Closing.");
});

it.each(["source", "history", "comment", "cleanup"])("recovers an interrupted %s write without repeating acceptance or losing history", (stage) => {
  const f = fixture();
  const dir = path.join(f.root, "manuscripts", f.document.id);
  const rename = fs.renameSync.bind(fs), unlink = fs.unlinkSync.bind(fs);
  if (stage === "cleanup") vi.spyOn(fs, "unlinkSync").mockImplementation((file) => { if (String(file).endsWith(".suggestion-apply.json")) throw new Error("synthetic crash"); unlink(file); });
  else vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    const target = String(to);
    if ((stage === "source" && target === path.join(dir, f.file.path)) ||
        (stage === "history" && target.includes("/.history/") && !target.includes("/blobs/")) ||
        (stage === "comment" && target.endsWith(`${f.thread.id}.json`))) throw new Error("synthetic crash");
    rename(from, to);
  });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept)).toThrow("synthetic crash");
  vi.restoreAllMocks();
  const restarted = new ManuscriptStore(f.root), document = restarted.read(f.document.id);
  expect(document.files.find((file) => file.path === f.file.path)?.content).toBe("Opening. A more precise claim. Closing.");
  expect(restarted.comments(f.document.id)[0]?.suggestion?.status).toBe("accepted");
  expect(restarted.history(f.document.id, f.file.path).map((entry) => entry.reason)).toEqual(["suggestion", "saved"]);
  expect(restarted.acceptSuggestion(f.document.id, f.thread.id, f.accept).file.content).toBe("Opening. A more precise claim. Closing.");
  expect(fs.existsSync(path.join(dir, ".suggestion-apply.json"))).toBe(false);
});

it("does not overwrite an external edit made after an interrupted acceptance", () => {
  const f = fixture(), rename = fs.renameSync.bind(fs);
  const target = path.join(f.root, "manuscripts", f.document.id, f.file.path);
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (String(to) === target) throw new Error("synthetic crash"); rename(from, to); });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept)).toThrow("synthetic crash");
  vi.restoreAllMocks();
  fs.writeFileSync(target, "An external correction.");
  expect(() => new ManuscriptStore(f.root).read(f.document.id)).toThrow(/file changed elsewhere/);
  expect(fs.readFileSync(target, "utf8")).toBe("An external correction.");
});

it("checks cross-document requests, deleted threads, retry changes and journal symlinks", () => {
  const f = fixture(), other = f.store.create({ name: "Unrelated document" });
  expect(() => f.store.acceptSuggestion(other.id, f.thread.id, f.accept)).toThrow(/not found/);
  f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept);
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, { ...f.accept, expectedRevision: "0".repeat(64) })).toThrow();
  f.store.updateComment(f.document.id, f.thread.id, { action: "delete", requestId: randomUUID(), expectedVersion: 2 });
  expect(() => f.store.acceptSuggestion(f.document.id, f.thread.id, f.accept)).toThrow(/not found/);
  const record = JSON.parse(fs.readFileSync(path.join(f.root, "manuscripts", f.document.id, ".comments", `${f.thread.id}.json`), "utf8"));
  expect(record).not.toHaveProperty("suggestion");
  fs.symlinkSync(os.tmpdir(), path.join(f.root, "manuscripts", f.document.id, ".suggestion-apply.json"));
  expect(() => f.store.read(f.document.id)).toThrow(/links/);
});
