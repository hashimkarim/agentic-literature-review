import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ManuscriptDocument, ManuscriptFile } from "@litagent/contracts";
import { WritingSession } from "./writing-session";

function memoryStorage() {
  const map = new Map<string, string>();
  return { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
function document(): ManuscriptDocument {
  return { id: "manuscript_0000000000000001", projectId: "project_1", name: "Fixture", entryFile: "main.tex", createdAt: "2026-09-24T00:00:00Z", files: [{ path: "main.tex", content: "Original", revision: "a".repeat(64) }, { path: "methods.tex", content: "Methods", revision: "b".repeat(64) }] };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
  expect(new WritingSession({ ...document(), projectId: "project_other" }, write, storage, "three").getSnapshot().files["main.tex"]?.content).toBe("Original");
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
