import { describe, expect, it, vi } from "vitest";
import { QaResponseSchema, QaThreadSchema } from "@litagent/contracts";
import { ChatSessions, type ChatScope } from "./chat-sessions";

const paperA = { projectId: null, paperId: "paper-a" };
const paperB = { projectId: null, paperId: "paper-b" };
const selection = { providerId: "fixture", model: "fixture-model" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function thread(scope: ChatScope, title = scope.paperId ?? "Global") {
  const timestamp = new Date().toISOString();
  return QaThreadSchema.parse({ id: JSON.stringify(scope), title, ...scope, createdAt: timestamp, updatedAt: timestamp });
}

function response(question: string) {
  return QaResponseSchema.parse({ answer: `Answer: ${question}`, question, evidence: [], messageId: `reply-${question}` });
}

function history(scope: ChatScope, questions: string[]) {
  const saved = thread(scope);
  return { ...saved, messages: questions.map((question) => ({
    id: `reply-${question}`, role: "assistant" as const, content: `Answer: ${question}`,
    createdAt: saved.createdAt, response: response(question)
  })) };
}

function fixture() {
  const api = {
    qaThread: vi.fn(async (scope: ChatScope) => thread(scope)),
    qa: vi.fn(async ({ question }: { question: string }) => response(question)),
    clearQaThread: vi.fn(async (scope: ChatScope) => thread(scope, "New conversation"))
  };
  return { api, sessions: new ChatSessions(api) };
}

describe("scope-owned chat sessions", () => {
  it("keeps out-of-order history loads in their original scope", async () => {
    const { api, sessions } = fixture();
    const a = deferred<ReturnType<typeof thread>>();
    api.qaThread.mockImplementation((scope) => scope.paperId === paperA.paperId ? a.promise : Promise.resolve(thread(scope)));
    const first = sessions.load(paperA);
    await sessions.load(paperB);
    expect(sessions.get(paperB).thread?.paperId).toBe(paperB.paperId);
    a.resolve(thread(paperA));
    await first;
    expect(sessions.get(paperB).thread?.paperId).toBe(paperB.paperId);
    expect(sessions.get(paperA).thread?.paperId).toBe(paperA.paperId);
  });

  it("isolates global, paper and project drafts for the same paper", () => {
    const { sessions } = fixture();
    const scopes = [paperA, { ...paperA, projectId: "p1" }, { ...paperA, projectId: "p2" }, { projectId: null, paperId: null }];
    scopes.forEach((scope, index) => sessions.setDraft(scope, `draft ${index}`));
    scopes.forEach((scope, index) => expect(sessions.get(scope).draft).toBe(`draft ${index}`));
  });

  it("deduplicates overlapping loads, including StrictMode effects", async () => {
    const { api, sessions } = fixture();
    const pending = deferred<ReturnType<typeof thread>>();
    api.qaThread.mockReturnValue(pending.promise);
    const first = sessions.load(paperA);
    const second = sessions.load(paperA);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(api.qaThread).toHaveBeenCalledTimes(1);
    pending.resolve(thread(paperA));
    await first;
  });

  it("does not restore old history after archiving while a load is pending", async () => {
    const { api, sessions } = fixture();
    const pending = deferred<ReturnType<typeof thread>>();
    api.qaThread.mockReturnValue(pending.promise);
    const loading = sessions.load(paperA);
    await sessions.clear(paperA);
    pending.resolve(thread(paperA, "Old conversation"));
    await loading;
    expect(sessions.get(paperA).thread?.title).toBe("New conversation");
  });

  it("finishing one scope cannot clear another scope's pending request", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    await sessions.load(paperB);
    const a = deferred<ReturnType<typeof response>>();
    const b = deferred<ReturnType<typeof response>>();
    api.qa.mockImplementation(({ question }) => question === "A" ? a.promise : b.promise);
    expect(sessions.hasPending()).toBe(false);
    const first = sessions.ask(paperA, "A", selection);
    const second = sessions.ask(paperB, "B", selection);
    expect(sessions.hasPending()).toBe(true);
    a.resolve(response("A"));
    await first;
    expect(sessions.get(paperB).pending?.question).toBe("B");
    expect(sessions.hasPending()).toBe(true);
    b.reject(new Error("B failed"));
    await second;
    expect(sessions.hasPending()).toBe(false);
    expect(sessions.get(paperA).error).toBeNull();
    expect(sessions.get(paperB).draft).toBe("B");
  });

  it("blocks duplicate sends and archiving the same scope while sending", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    const pending = deferred<ReturnType<typeof response>>();
    api.qa.mockReturnValue(pending.promise);
    const sending = sessions.ask(paperA, "A", selection);
    expect(await sessions.ask(paperA, "A again", selection)).toBe(false);
    expect(await sessions.clear(paperA)).toBe(false);
    await sessions.load(paperA);
    expect(api.qa).toHaveBeenCalledTimes(1);
    expect(api.clearQaThread).not.toHaveBeenCalled();
    expect(api.qaThread).toHaveBeenCalledTimes(1);
    pending.resolve(response("A"));
    await sending;
  });

  it("keeps a saved answer when history refresh fails without retrying the POST", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    api.qaThread.mockRejectedValue(new Error("History unavailable"));
    expect(await sessions.ask(paperA, "Saved", selection)).toBe(true);
    await sessions.load(paperA);
    const state = sessions.get(paperA);
    expect(state.thread?.messages.map((message) => message.content)).toEqual(["Saved", "Answer: Saved"]);
    expect(state.error).toBeNull();
    expect(state.loadError).toBe("History unavailable");
    expect(api.qa).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed question and a load error in only their source scope", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    api.qa.mockRejectedValue(new Error("Answer unavailable"));
    const sending = sessions.ask(paperA, "Unsent question", selection);
    sessions.setDraft(paperB, "Unrelated draft");
    await sending;
    expect(sessions.get(paperA).draft).toBe("Unsent question");
    expect(sessions.get(paperB).draft).toBe("Unrelated draft");
    expect(sessions.get(paperB).error).toBeNull();
    await sessions.load(paperA);
    api.qaThread.mockRejectedValue(new Error("Offline"));
    await sessions.load(paperA);
    expect(sessions.get(paperA).thread).not.toBeNull();
    expect(sessions.get(paperA).loadError).toBe("Offline");
    expect(sessions.get(paperB).loadError).toBeNull();
  });

  it("refuses mismatched history and requires initial history before sending", async () => {
    const { api, sessions } = fixture();
    expect(await sessions.ask(paperA, "A", selection)).toBe(false);
    api.qaThread.mockResolvedValue(thread(paperB));
    await sessions.load(paperA);
    expect(sessions.get(paperA).thread).toBeNull();
    expect(sessions.get(paperA).loadError).toMatch(/does not match/);
    expect(api.qa).not.toHaveBeenCalled();
  });

  it("allows history reload after a synchronous transport failure", async () => {
    const { api, sessions } = fixture();
    api.qaThread.mockImplementationOnce(() => { throw new Error("Disconnected"); });
    await sessions.load(paperA);
    expect(sessions.get(paperA).loadError).toBe("Disconnected");
    await sessions.load(paperA);
    expect(sessions.get(paperA).thread?.paperId).toBe(paperA.paperId);
    expect(sessions.get(paperA).loadError).toBeNull();
  });

  it("reloads a conflicting conversation and preserves the question for an explicit retry", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    api.qa.mockRejectedValueOnce(new Error("Conversation changed"));
    api.qaThread.mockResolvedValue({ ...thread(paperA), revision: 3 });
    await sessions.ask(paperA, "Retry after reload", selection);
    await sessions.load(paperA);
    expect(api.qa).toHaveBeenCalledWith(expect.objectContaining({ threadRevision: 0 }));
    expect(sessions.get(paperA).thread?.revision).toBe(3);
    expect(sessions.get(paperA).draft).toBe("Retry after reload");
    expect(api.qa).toHaveBeenCalledTimes(1);
    await sessions.ask(paperA, sessions.get(paperA).draft, selection);
    expect(api.qa).toHaveBeenLastCalledWith(expect.objectContaining({ threadRevision: 3 }));
  });

  it("uses the acknowledged revision even when history refresh fails", async () => {
    const { api, sessions } = fixture();
    await sessions.load(paperA);
    api.qa.mockResolvedValueOnce({ ...response("saved"), threadRevision: 1 });
    api.qaThread.mockRejectedValue(new Error("History offline"));
    await sessions.ask(paperA, "saved", selection);
    await sessions.load(paperA);
    await sessions.ask(paperA, "next question", selection);
    expect(api.qa).toHaveBeenLastCalledWith(expect.objectContaining({ threadRevision: 1 }));
  });

  it("keeps evidence selection in its own scope across history reloads", async () => {
    const { api, sessions } = fixture();
    api.qaThread.mockImplementation(async (scope) => history(scope, ["method", "result"]));
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-result");
    sessions.selectAnswer(paperA, "reply-method");
    await sessions.load(paperB);
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-method");
    expect(sessions.get(paperB).selectedAnswerId).toBe("reply-result");
    sessions.selectAnswer(paperA, "missing-answer");
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-method");
  });

  it("selects a newly saved answer even when refreshing history fails", async () => {
    const { api, sessions } = fixture();
    api.qaThread.mockResolvedValue(history(paperA, ["method", "result"]));
    await sessions.load(paperA);
    sessions.selectAnswer(paperA, "reply-method");
    api.qaThread.mockRejectedValue(new Error("History offline"));
    await sessions.ask(paperA, "limitations", selection);
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-limitations");
  });

  it("selects newer answers from another tab and clears removed evidence", async () => {
    const { api, sessions } = fixture();
    api.qaThread.mockResolvedValue(history(paperA, ["method", "result"]));
    await sessions.load(paperA);
    sessions.selectAnswer(paperA, "reply-method");
    api.qaThread.mockResolvedValue(history(paperA, ["method", "result", "limitations"]));
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-limitations");
    api.qaThread.mockResolvedValue(thread(paperA));
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBeNull();
  });

  it("clears evidence selection only after the conversation is archived", async () => {
    const { api, sessions } = fixture();
    api.qaThread.mockResolvedValue(history(paperA, ["method"]));
    await sessions.load(paperA);
    api.clearQaThread.mockRejectedValueOnce(new Error("Archive failed"));
    expect(await sessions.clear(paperA)).toBe(false);
    await sessions.load(paperA);
    expect(sessions.get(paperA).selectedAnswerId).toBe("reply-method");
    expect(await sessions.clear(paperA)).toBe(true);
    expect(sessions.get(paperA).selectedAnswerId).toBeNull();
  });
});
