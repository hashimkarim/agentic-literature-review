import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ManuscriptStore } from "./manuscripts";
import type { CommentSelection, ManuscriptCommentView, UpdateManuscriptComment } from "@litagent/contracts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { force: true, recursive: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "writing-comments-")); roots.push(root);
  const store = new ManuscriptStore(root), document = store.create({ name: "Synthetic comments" });
  const content = `${"Context before. ".repeat(6)}A supported claim.${" Context after.".repeat(6)}`;
  const file = store.writeFile(document.id, { path: "sections/one.tex", content, expectedRevision: null });
  const from = content.indexOf("A supported claim.");
  const selection: CommentSelection = { path: file.path, revision: file.revision, from, to: from + 18, quote: "A supported claim." };
  const request = { requestId: randomUUID(), selection, body: "Which experiment supports this?" };
  const update = (thread: ManuscriptCommentView, action: Omit<UpdateManuscriptComment, "expectedVersion" | "requestId">) =>
    store.updateComment(document.id, thread.id, { ...action, expectedVersion: thread.version, requestId: randomUUID() });
  return { root, store, document, file, selection, request, update };
}

it("persists anchored discussion, edits, replies, resolve/reopen and deletion without editing TeX", () => {
  const f = fixture(), before = f.store.read(f.document.id);
  let thread = f.store.createComment(f.document.id, f.request);
  expect(thread).toMatchObject({ status: "open", version: 1, location: { state: "attached", from: f.selection.from } });
  expect(thread).not.toHaveProperty("creationHash");
  expect(f.store.createComment(f.document.id, f.request)).toEqual(thread);
  const reply = { action: "reply", body: "See the held-out evaluation.", expectedVersion: thread.version, requestId: randomUUID() };
  thread = f.store.updateComment(f.document.id, thread.id, reply);
  expect(f.store.updateComment(f.document.id, thread.id, reply)).toEqual(thread);
  expect(thread.messages).toHaveLength(2);
  expect(() => f.update({ ...thread, version: 1 }, { action: "resolve" })).toThrow(/changed elsewhere/);
  thread = f.store.updateComment(f.document.id, thread.id, { action: "edit", messageId: f.request.requestId, body: "Add a citation.", expectedVersion: thread.version, requestId: randomUUID() });
  expect(thread.messages[0]!.body).toBe("Add a citation.");
  thread = f.update(thread, { action: "resolve" });
  expect(() => f.store.updateComment(f.document.id, thread.id, { action: "reply", body: "Late reply", expectedVersion: thread.version, requestId: randomUUID() })).toThrow(/Reopen/);
  thread = f.update(thread, { action: "reopen" });
  const restarted = new ManuscriptStore(f.root);
  expect(restarted.comments(f.document.id)).toEqual([thread]);
  thread = f.store.updateComment(f.document.id, thread.id, { action: "delete-message", messageId: reply.requestId, expectedVersion: thread.version, requestId: randomUUID() });
  expect(thread.messages[1]!.body).toBeNull();
  thread = f.update(thread, { action: "delete" });
  expect(thread).toMatchObject({ status: "deleted", anchor: null, messages: [] });
  expect(restarted.comments(f.document.id)).toEqual([]);
  expect(() => f.store.createComment(f.document.id, f.request)).toThrow(/deleted/);
  expect(f.store.read(f.document.id)).toEqual(before);
});

it("follows unchanged text and folder renames, flags changed/missing text and permits explicit reattachment", () => {
  const f = fixture(); let thread = f.store.createComment(f.document.id, f.request);
  let file = f.store.writeFile(f.document.id, { path: f.file.path, content: `New opening.\n${f.file.content}`, expectedRevision: f.file.revision });
  expect(f.store.comments(f.document.id)[0]!.location).toMatchObject({ state: "moved", from: f.selection.from + 13, line: 2 });
  const document = f.store.read(f.document.id);
  f.store.changeTree(document.id, { action: "move", path: "sections", destination: "chapters", expectedRevision: document.treeRevision });
  thread = f.store.comments(f.document.id)[0]!;
  expect(thread.anchor?.path).toBe("chapters/one.tex");
  expect(thread.location?.state).toBe("moved");
  file = f.store.writeFile(document.id, { path: "chapters/one.tex", content: "A corrected claim.", expectedRevision: file.revision });
  expect(f.store.comments(document.id)[0]!.location?.state).toBe("outdated");
  thread = f.store.updateComment(document.id, thread.id, { action: "reattach", expectedVersion: thread.version, requestId: randomUUID(), selection: { path: file.path, revision: file.revision, from: 0, to: file.content.length, quote: file.content } });
  expect(thread.location?.state).toBe("attached");
  f.store.deleteFile(document.id, { path: file.path, expectedRevision: file.revision });
  expect(f.store.comments(document.id)[0]!.location?.state).toBe("missing");
  expect(f.store.comments(document.id)[0]!.messages[0]!.body).toBe(f.request.body);
});

it("rejects stale or forged selections, changed retry payloads, unsafe paths and cross-document threads", () => {
  const f = fixture(); const thread = f.store.createComment(f.document.id, f.request);
  expect(() => f.store.createComment(f.document.id, { ...f.request, body: "Changed retry" })).toThrow(/already used/);
  expect(() => f.store.createComment(f.document.id, { ...f.request, requestId: randomUUID(), selection: { ...f.selection, quote: "An invented claim." } })).toThrow(/Selected text changed/);
  expect(() => f.store.createComment(f.document.id, { ...f.request, requestId: randomUUID(), selection: { ...f.selection, revision: "0".repeat(64) } })).toThrow(/Selected text changed/);
  expect(() => f.store.createComment(f.document.id, { ...f.request, selection: { ...f.selection, path: "../outside.tex" } })).toThrow();
  expect(() => f.store.createComment(f.document.id, { ...f.request, body: " " })).toThrow();
  const other = f.store.create({ name: "Other document" });
  expect(() => f.store.updateComment(other.id, thread.id, { action: "resolve", expectedVersion: 1, requestId: randomUUID() })).toThrow(/not found/);
  expect(f.store.comments(other.id)).toEqual([]);
});

it("never silently jumps to the first duplicated or context-free quote", () => {
  const f = fixture(); f.store.createComment(f.document.id, f.request);
  let file = f.store.writeFile(f.document.id, { path: f.file.path, content: f.file.content + "\n" + f.file.content, expectedRevision: f.file.revision });
  expect(f.store.comments(f.document.id)[0]!.location?.state).toBe("outdated");
  file = f.store.writeFile(f.document.id, { path: file.path, content: "Unrelated text. A supported claim. Another discussion.", expectedRevision: file.revision });
  expect(f.store.comments(f.document.id)[0]!.location?.state).toBe("outdated");
});

it("rejects comment storage symlinks without reading outside the document", () => {
  const f = fixture();
  fs.symlinkSync(os.tmpdir(), path.join(f.root, "manuscripts", f.document.id, ".comments"));
  expect(() => f.store.comments(f.document.id)).toThrow(/links/);
  expect(() => f.store.createComment(f.document.id, f.request)).toThrow(/links/);
});
