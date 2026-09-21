import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QaResponseSchema, type QaResponse } from "@litagent/contracts";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";
import { WorkflowEngine } from "./index";

const disposers: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  disposers.splice(0).forEach((dispose) => dispose());
});

function deferred() {
  let resolve!: (response: QaResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<QaResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function answer(question: string) {
  return QaResponseSchema.parse({ question, answer: `Answer to ${question}`, evidence: [] });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-thread-test-"));
  const repo = new LitAgentRepository(root);
  repo.init();
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
  const engine = new WorkflowEngine(repo, index);
  const generate = vi.spyOn(engine, "answerQuestionWithProvider").mockImplementation(async ({ question }) => answer(question));
  disposers.push(() => { index.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { repo, index, engine, generate };
}

describe("conversation transaction boundaries", () => {
  it("rejects overlapping sends and archiving while an answer is pending", async () => {
    const { engine, generate } = fixture();
    const pending = deferred();
    generate.mockReturnValue(pending.promise);
    const sending = engine.answerQuestionInThread({ question: "first", threadRevision: 0 });
    await expect(engine.answerQuestionInThread({ question: "second", threadRevision: 0 })).rejects.toMatchObject({ code: "qa_thread_busy" });
    expect(() => engine.clearQaThread({})).toThrow(/still running/);
    expect(generate).toHaveBeenCalledTimes(1);
    pending.resolve(answer("first"));
    const saved = await sending;
    expect(saved.response.threadRevision).toBe(1);
    expect(engine.readQaThread({}).messages.map((message) => message.content)).toEqual(["first", "Answer to first"]);
  });

  it("allows different source scopes to finish independently", async () => {
    const { engine, generate } = fixture();
    const pending = deferred();
    generate.mockImplementation(async ({ question }) => question === "first" ? pending.promise : answer(question));
    const first = engine.answerQuestionInThread({ question: "first", paperId: "a" });
    await engine.answerQuestionInThread({ question: "second", paperId: "a", projectId: "project" });
    expect(engine.readQaThread({ paperId: "a", projectId: "project" }).messages).toHaveLength(2);
    expect(engine.readQaThread({ paperId: "a" }).messages).toHaveLength(0);
    pending.resolve(answer("first"));
    await first;
  });

  it("rejects a stale browser revision before invoking any generation", async () => {
    const { engine, generate } = fixture();
    engine.clearQaThread({});
    await expect(engine.answerQuestionInThread({ question: "old tab", threadRevision: 0 })).rejects.toMatchObject({ code: "qa_thread_changed" });
    expect(generate).not.toHaveBeenCalled();
    expect(engine.readQaThread({}).revision).toBe(1);
    await engine.answerQuestionInThread({ question: "new tab", threadRevision: 1 });
    expect(engine.readQaThread({}).revision).toBe(2);
  });

  it("does not append a response if the conversation changed during generation", async () => {
    const { engine, generate } = fixture();
    const pending = deferred();
    generate.mockReturnValue(pending.promise);
    const sending = engine.answerQuestionInThread({ question: "stale answer" });
    engine.recordQaExchange({}, answer("separate update"));
    pending.resolve(answer("stale answer"));
    await expect(sending).rejects.toMatchObject({ code: "qa_thread_changed" });
    expect(engine.readQaThread({}).messages.map((message) => message.content)).toEqual(["separate update", "Answer to separate update"]);
  });

  it("does not let a stale tab archive newer messages it has not read", async () => {
    const { engine, repo } = fixture();
    engine.recordQaExchange({}, answer("newer message"));
    expect(() => engine.clearQaThread({ threadRevision: 0 })).toThrow(/changed in another request/);
    expect(engine.readQaThread({}).messages).toHaveLength(2);
    expect(fs.existsSync(repo.resolve(".litagent/chat-threads/archive"))).toBe(false);
    expect(engine.clearQaThread({ threadRevision: 1 }).revision).toBe(2);
  });

  it("releases the conversation after a generation failure", async () => {
    const { engine, generate } = fixture();
    generate.mockRejectedValueOnce(new Error("Fixture failure"));
    await expect(engine.answerQuestionInThread({ question: "failed" })).rejects.toThrow("Fixture failure");
    await engine.answerQuestionInThread({ question: "retry", threadRevision: 0 });
    expect(engine.readQaThread({}).messages).toHaveLength(2);
    expect(engine.clearQaThread({}).messages).toHaveLength(0);
  });

  it("persists the revision and archives messages across a new chat and restart", async () => {
    const { repo, index, engine } = fixture();
    await engine.answerQuestionInThread({ question: "old conversation" });
    const cleared = engine.clearQaThread({});
    expect(cleared.revision).toBe(2);
    const archive = repo.resolve(".litagent/chat-threads/archive");
    const files = fs.readdirSync(archive);
    expect(files).toHaveLength(1);
    const stored = JSON.parse(fs.readFileSync(path.join(archive, files[0]!), "utf8"));
    expect(stored.messages).toHaveLength(2);
    expect(stored.revision).toBe(1);
    const reopened = new WorkflowEngine(repo, index).readQaThread({});
    expect(reopened.revision).toBe(2);
    expect(reopened.messages).toEqual([]);
    expect(engine.clearQaThread({}).revision).toBe(3);
  });

  it("preserves the old thread when atomic replacement fails", async () => {
    const { engine, repo } = fixture();
    engine.recordQaExchange({}, answer("preserved"));
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("Disk unavailable"); });
    expect(() => engine.clearQaThread({})).toThrow("Disk unavailable");
    expect(engine.readQaThread({}).messages).toHaveLength(2);
    expect(engine.readQaThread({}).revision).toBe(1);
    expect(fs.readdirSync(repo.resolve(".litagent/chat-threads")).some((file) => file.endsWith(".tmp"))).toBe(false);
    rename.mockRestore();
    expect(engine.clearQaThread({}).messages).toHaveLength(0);
  });

  it("treats reordered or duplicate selected-paper IDs as one conversation", async () => {
    const { engine, generate } = fixture();
    const pending = deferred();
    generate.mockReturnValue(pending.promise);
    const first = engine.answerQuestionInThread({ question: "selection", paperIds: ["a", "b"] });
    await expect(engine.answerQuestionInThread({ question: "duplicate scope", paperIds: ["b", "a", "b"] })).rejects.toMatchObject({ code: "qa_thread_busy" });
    pending.resolve(answer("selection"));
    await first;
    expect(engine.readQaThread({ paperIds: ["b", "a"] }).messages).toHaveLength(2);
  });
});
