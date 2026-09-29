import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManuscriptDocument, ManuscriptFile } from "@litagent/contracts";
import { WritingSession } from "./writing-session";

function memoryStorage() {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
function document(): ManuscriptDocument {
  return { id: "manuscript_0000000000000001", projectIds: ["project_1"], name: "Fixture", entryFile: "main.tex", createdAt: "2026-09-24T00:00:00Z", files: [{ path: "main.tex", content: "Original", revision: "a".repeat(64) }, { path: "methods.tex", content: "Methods", revision: "b".repeat(64) }] };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("refreshes clean linked files and additions without overwriting dirty text", async () => {
  const write = vi.fn();
  const storage = memoryStorage(), session = new WritingSession(document(), write, storage, "linked");
  session.edit("main.tex", "Unsaved browser text");
  const next = document();
  next.files = [{ path: "main.tex", content: "External edit", revision: "c".repeat(64) }, { path: "new.tex", content: "New external file", revision: "d".repeat(64) }];
  expect(session.reconcileRemote(next)).toBe(true);
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "Unsaved browser text", state: "conflict", revision: "a".repeat(64) });
  expect(session.getSnapshot().files["methods.tex"]).toBeUndefined();
  expect(session.getSnapshot().files["new.tex"]?.content).toBe("New external file");
  await vi.advanceTimersByTimeAsync(3000);
  expect(write).not.toHaveBeenCalled();
  expect(await session.flush()).toBe(false);
  session.acceptRemote(next.files[0]!);
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "External edit", state: "saved" });
  session.dispose();
});

it("retains a removed dirty file across folder refresh and browser recovery", async () => {
  const storage = memoryStorage(), write = vi.fn();
  const session = new WritingSession(document(), write, storage, "linked");
  session.edit("main.tex", "Local work");
  const next = { ...document(), files: document().files.filter((file) => file.path !== "main.tex") };
  session.reconcileRemote(next);
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "Local work", state: "conflict" });
  session.dispose();
  const recovered = new WritingSession(next, write, storage, "reopened");
  expect(recovered.getSnapshot().files["main.tex"]).toMatchObject({ content: "Local work", state: "conflict" });
  await recovered.flush(); expect(write).not.toHaveBeenCalled();
  recovered.dispose();
});

it("pauses saves while a linked folder is unavailable and reconciles before resuming", async () => {
  const write = vi.fn().mockResolvedValue({ path: "main.tex", content: "Local", revision: "d".repeat(64) });
  const session = new WritingSession(document(), write, memoryStorage(), "linked");
  session.edit("main.tex", "Local"); session.pauseSaves("Folder missing");
  await vi.advanceTimersByTimeAsync(3000); expect(write).not.toHaveBeenCalled();
  expect(await session.flush()).toBe(false);
  session.reconcileRemote(document());
  await vi.advanceTimersByTimeAsync(1300);
  expect(write).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().syncError).toBeNull();
  session.dispose();
});

it("does not apply poll snapshots during in-flight saves", async () => {
  let finish!: (file: ManuscriptFile) => void;
  const session = new WritingSession(document(), () => new Promise((resolve) => { finish = resolve; }), memoryStorage(), "linked");
  session.edit("main.tex", "Local"); const pending = session.save("main.tex"); await Promise.resolve();
  expect(session.reconcileRemote(document())).toBe(false);
  finish({ path: "main.tex", content: "Local", revision: "f".repeat(64) }); await pending;
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "Local", state: "saved" });
  session.dispose();
});

it("retains edits made during an active save and uses the acknowledged revision next", async () => {
  let resolve!: (file: ManuscriptFile) => void;
  const write = vi.fn().mockImplementationOnce(() => new Promise<ManuscriptFile>((done) => { resolve = done; }))
    .mockResolvedValueOnce({ path: "main.tex", content: "Third", revision: "c".repeat(64) });
  const session = new WritingSession(document(), write, memoryStorage(), "one");
  session.edit("main.tex", "Second");
  const saving = session.save("main.tex");
  await Promise.resolve();
  session.edit("main.tex", "Third");
  expect(session.save("main.tex")).toBe(saving);
  resolve({ path: "main.tex", content: "Second", revision: "b".repeat(64) });
  await saving;
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "Third", state: "dirty", revision: "b".repeat(64) });
  await session.save("main.tex");
  expect(write.mock.calls[1]?.[0]).toMatchObject({ content: "Third", expectedRevision: "b".repeat(64) });
  expect(session.getSnapshot().files["main.tex"]?.state).toBe("saved");
  session.dispose();
});

it("keeps a reverted draft unsaved until an in-flight write is reconciled", async () => {
  let resolve!: (file: ManuscriptFile) => void;
  const storage = memoryStorage();
  const session = new WritingSession(document(), () => new Promise((done) => { resolve = done; }), storage, "one");
  session.edit("main.tex", "Second"); const saving = session.save("main.tex"); await Promise.resolve();
  session.edit("main.tex", "Original");
  expect(storage.length).toBe(1);
  expect(session.getSnapshot().files["main.tex"]?.state).toBe("dirty");
  resolve({ path: "main.tex", content: "Second", revision: "b".repeat(64) }); await saving;
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ content: "Original", state: "dirty" }); session.dispose();
});

it("recovers drafts across reload without autosaving until reviewed", async () => {
  const storage = memoryStorage(); const write = vi.fn();
  const first = new WritingSession(document(), write, storage, "one");
  first.edit("main.tex", "Unsaved work"); first.dispose();
  const next = new WritingSession(document(), write, storage, "two");
  expect(next.getSnapshot().files["main.tex"]).toMatchObject({ content: "Unsaved work", state: "recovered" });
  await vi.advanceTimersByTimeAsync(5000); expect(write).not.toHaveBeenCalled();
  expect(new WritingSession({ ...document(), projectIds: [] }, write, storage, "three").getSnapshot().files["main.tex"]?.content).toBe("Unsaved work");
  expect(new WritingSession({ ...document(), id: "manuscript_0000000000000002" }, write, storage, "four").getSnapshot().files["main.tex"]?.content).toBe("Original");
});

it("recovers legacy project-scoped drafts after moving and unlinking a document", async () => {
  const doc = document();
  const storage = memoryStorage();
  const legacyKey = `litagent:writing:deleted_project:${doc.id}:old-tab:main.tex`;
  storage.setItem(legacyKey, JSON.stringify({ path: "main.tex", content: "Legacy draft", savedContent: "Original", expectedRevision: "a".repeat(64), updatedAt: Date.now() }));
  const write = vi.fn().mockResolvedValue({ path: "main.tex", content: "Legacy draft", revision: "c".repeat(64) });
  const next = new WritingSession({ ...doc, projectIds: [] }, write, storage, "new-tab");
  expect(next.getSnapshot().files["main.tex"]).toMatchObject({ content: "Legacy draft", state: "recovered" });
  expect(storage.getItem(legacyKey)).not.toBeNull();
  await vi.advanceTimersByTimeAsync(5000); expect(write).not.toHaveBeenCalled();
  await next.save("main.tex");
  expect(storage.getItem(legacyKey)).toBeNull();
});

it("does not automatically retry a conflict and rebases only after explicit review", async () => {
  const write = vi.fn().mockRejectedValueOnce(Object.assign(new Error("File changed"), { status: 409 }))
    .mockResolvedValueOnce({ path: "main.tex", content: "Mine", revision: "c".repeat(64) });
  const session = new WritingSession(document(), write, memoryStorage(), "one");
  session.edit("main.tex", "Mine"); await session.save("main.tex");
  expect(session.getSnapshot().files["main.tex"]?.state).toBe("conflict");
  await vi.advanceTimersByTimeAsync(5000); expect(write).toHaveBeenCalledTimes(1);
  session.acceptRemote({ path: "main.tex", content: "Theirs", revision: "b".repeat(64) }, true);
  await session.save("main.tex");
  expect(write.mock.calls[1]?.[0]).toMatchObject({ content: "Mine", expectedRevision: "b".repeat(64) });
});

it("retains local text on network failure and supports an explicit retry", async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({ path: "main.tex", content: "Mine", revision: "c".repeat(64) });
  const storage = memoryStorage(); const session = new WritingSession(document(), write, storage, "one");
  session.edit("main.tex", "Mine"); await session.save("main.tex");
  expect(session.getSnapshot().files["main.tex"]).toMatchObject({ state: "error", content: "Mine" }); expect(storage.length).toBe(1);
  await session.save("main.tex"); expect(storage.length).toBe(0);
});

it("does not erase another tab's newer recovery record", async () => {
  const storage = memoryStorage(); const first = new WritingSession(document(), vi.fn(), storage, "one");
  first.edit("main.tex", "Older"); first.dispose();
  const second = new WritingSession(document(), async () => ({ path: "main.tex", content: "Older", revision: "b".repeat(64) }), storage, "two");
  first.edit("main.tex", "Newer in original tab"); first.dispose();
  await second.save("main.tex");
  const third = new WritingSession(document(), vi.fn(), storage, "three");
  expect(third.getSnapshot().files["main.tex"]?.content).toBe("Newer in original tab");
});

it("surfaces unavailable recovery storage without blocking server saves", async () => {
  const session = new WritingSession(document(), async () => ({ path: "main.tex", content: "Mine", revision: "b".repeat(64) }), null, "one");
  session.edit("main.tex", "Mine"); expect(session.getSnapshot().storageError).toContain("recovery is unavailable");
  await session.save("main.tex"); expect(session.getSnapshot().files["main.tex"]?.state).toBe("saved");
});
