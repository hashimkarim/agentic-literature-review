import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentHarness, AgentProviderCatalog, type ProviderRunResult, type ProviderRunStartInput } from "@litagent/agents";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";
import { WorkflowEngine } from "./index";

const disposers: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) dispose();
});

type Reply = (input: ProviderRunStartInput, attempt: number) => Partial<ProviderRunResult>;

function fixture(reply: Reply = () => ({}), markdown: string | null = "# Results\n\nThe optical detector achieves an accuracy of 0.92 on the validation set.") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-qa-regression-"));
  const repo = new LitAgentRepository(root);
  repo.init();
  const { paper } = repo.importPaper({ metadata: { title: "Optical detector study" } });
  if (markdown !== null) repo.writeMarkdown(paper.id, markdown);
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
  index.rebuild(repo);
  disposers.push(() => { index.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const catalog = new AgentProviderCatalog([{
    id: "qa-test", label: "QA test provider", command: process.execPath,
    versionArgs: ["--version"], capabilities: ["research"],
    connectCommand: "", models: [], defaultModel: null,
    promptDelivery: "stdin", runArgs: () => []
  }]);
  const harness = new AgentHarness({ catalog });
  let attempt = 0;
  const start = vi.spyOn(harness, "startRun").mockImplementation((input) => {
    const result: ProviderRunResult = {
      sessionId: `session_${attempt}`, runId: input.runId, providerId: input.providerId,
      status: "completed", exitCode: 0, signal: null, failureClass: null,
      transcript: "", events: [], artifacts: [], ...reply(input, attempt++)
    };
    return {
      id: result.sessionId, runId: input.runId, providerId: input.providerId,
      cwd: input.cwd, prompt: input.prompt, status: result.status, process: null,
      events: new EventEmitter(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      finished: Promise.resolve(result)
    };
  });
  const engine = new WorkflowEngine(repo, index, catalog, harness);
  const request = { paperId: paper.id, question: "What accuracy does the optical detector achieve?", providerId: "qa-test", model: "test-model" };
  return { repo, paper, engine, start, request };
}

describe("Q&A failure boundaries", () => {
  it.each(["local-heuristic", "missing-provider"])("does not answer with heuristics when %s is selected", async (providerId) => {
    const { engine, request, start } = fixture();
    await expect(engine.answerQuestionWithProvider({ ...request, providerId })).rejects.toThrow(/provider/i);
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    { status: "failed" as const, failureClass: "auth" as const, expected: "auth" },
    { status: "cancelled" as const, failureClass: "cancelled" as const, expected: "cancelled" },
    { status: "completed" as const, failureClass: null, expected: "empty_output" }
  ])("reports $status without replacing the selected provider", async ({ status, failureClass, expected }) => {
    const { engine, request } = fixture(() => ({ status, failureClass }));
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow(expected);
    const run = engine.listRuns()[0];
    expect(run?.status).toBe(status === "cancelled" ? "cancelled" : "failed");
    expect(engine.readQaThread(request).messages).toEqual([]);
  });

  it("does not use partial output from a failed provider", async () => {
    const { engine, request } = fixture(() => ({
      status: "failed", failureClass: "rate_limit",
      transcript: "The optical detector achieves accuracy of 0.92."
    }));
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("rate_limit");
  });

  it("reports a missing conversion as a prerequisite, not a research finding", async () => {
    const { engine, request, start } = fixture(undefined, null);
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow(/conversion/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("surfaces harness failures without searching for substitute evidence", async () => {
    const { engine, request } = fixture(() => { throw new Error("transport unavailable"); });
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("transport unavailable");
    expect(engine.listRuns()[0]?.status).toBe("failed");
  });
});
