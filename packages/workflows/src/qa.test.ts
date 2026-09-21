import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentHarness, AgentProviderCatalog, AgentProviderSettingsStore, type ProviderRunResult, type ProviderRunStartInput } from "@litagent/agents";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";
import { WorkflowEngine } from "./index";
import { ProviderQaDraftSchema, type ProviderQaDraft } from "./qa-grounding";

const disposers: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) dispose();
});

type Reply = (input: ProviderRunStartInput, attempt: number) => Partial<ProviderRunResult>;

function fixture(reply: Reply = () => ({}), markdown: string | null = "# Results\n\nThe optical detector achieves an accuracy of 0.92 on the validation set.", rebuildIndex = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-qa-regression-"));
  const repo = new LitAgentRepository(root);
  repo.init();
  const { paper } = repo.importPaper({ metadata: { title: "Optical detector study" } });
  if (markdown !== null) repo.writeMarkdown(paper.id, markdown);
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
  if (rebuildIndex) index.rebuild(repo);
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
  return { repo, paper, engine, start, request, catalog, harness, index };
}

function draftReply(claims: ProviderQaDraft["claims"]): Partial<ProviderRunResult> {
  return { transcript: JSON.stringify({ status: claims.length ? "answered" : "not_found", claims }) };
}

function reviewInput(input: ProviderRunStartInput): { draft: ProviderQaDraft; markdownContext?: string; passages: Array<{ quote: string }> } {
  const raw = JSON.parse(input.prompt.split("Review input (JSON):\n")[1]!);
  return { ...raw, draft: ProviderQaDraftSchema.parse(raw.draft) };
}

function reviewReply(input: ProviderRunStartInput, supported = true, reason = "Cited passages support this claim."): Partial<ProviderRunResult> {
  const { draft } = reviewInput(input);
  return { transcript: JSON.stringify({
    supported, reason, claims: draft.claims.map((_, index) => ({ index, supported, reason }))
  }) };
}

function contextIds(input: ProviderRunStartInput): string[] {
  return [...new Set([...input.prompt.matchAll(/\[\[passage:([^\]\s]+)\]\]/g)].map((match) => match[1]!))];
}

describe("Q&A failure boundaries", () => {
  it.each(["local-heuristic", "missing-provider"])("does not answer with heuristics when %s is selected", async (providerId) => {
    const { engine, request, start } = fixture();
    await expect(engine.answerQuestionWithProvider({ ...request, providerId })).rejects.toThrow(/provider/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("requires a known provider to be enabled in settings", async () => {
    const { repo, index, catalog, harness, request, start } = fixture();
    const settings = new AgentProviderSettingsStore(repo.resolve(".litagent/provider-settings.json"));
    settings.patch("qa-test", { enabled: false }, [catalog.definition("qa-test")!]);
    const engine = new WorkflowEngine(repo, index, catalog, harness, settings);
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("Select a connected agent provider");
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

describe("Q&A claim-specific grounding", () => {
  it("keeps short follow-ups tied to this thread and changes evidence with the question", async () => {
    const { engine, request, repo, paper, start } = fixture((input) => {
      if (input.prompt.startsWith("LitAgent Q&A source review")) return reviewReply(input);
      const ids = contextIds(input);
      const resultsQuestion = input.prompt.includes("Question: What accuracy did it achieve?");
      return draftReply([{
        text: resultsQuestion ? "Accuracy was 0.92." : "The detector uses a convolutional network.",
        kind: "reported", passageIds: [ids[resultsQuestion ? 1 : 0]!]
      }]);
    }, "# Methods\n\nThe detector uses a convolutional network.\n\n# Results\n\nAccuracy was 0.92.");
    const first = await engine.answerQuestionWithProvider({ ...request, question: "Which model was used?" });
    engine.recordQaExchange(request, first);
    const second = await engine.answerQuestionWithProvider({ ...request, question: "What accuracy did it achieve?" });
    engine.recordQaExchange(request, second);
    const passages = repo.readPassages(paper.id);
    expect(first.evidence.map((evidence) => evidence.passageId)).toEqual([passages[0]!.id]);
    expect(second.evidence.map((evidence) => evidence.passageId)).toEqual([passages[1]!.id]);
    expect(start.mock.calls[2]?.[0].prompt).toContain("User: Which model was used?");
    expect(second.answer).toBe("Accuracy was 0.92. [1]");
    expect(second.evidence[0]?.confidence).toBeNull();
    expect(second.evidence[0]?.markdownHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.evidence[0]?.markdownHash).toBe(second.diagnostics.sources[0]?.markdownHash);
    const savedEvidence = engine.readQaThread(request).messages.at(-1)?.response?.evidence[0];
    expect(savedEvidence?.markdownHash).toBe(second.evidence[0]?.markdownHash);
    expect(engine.readQaThread(request).messages).toHaveLength(4);
  });

  it("repairs an invented number instead of accepting lexical overlap", async () => {
    const { engine, request, start, repo } = fixture((input) => {
      if (input.prompt.startsWith("LitAgent Q&A source review")) {
        const supported = !reviewInput(input).draft.claims[0]?.text.includes("0.99");
        expect(reviewInput(input).passages[0]?.quote).toContain("0.92");
        return reviewReply(input, supported, supported ? "The value matches." : "The source says 0.92, not 0.99.");
      }
      return draftReply([{
        text: input.prompt.includes("Repair the following draft once") ? "Accuracy was 0.92." : "Accuracy was 0.99.",
        kind: "reported", passageIds: [contextIds(input)[0]!]
      }]);
    });
    const response = await engine.answerQuestionWithProvider(request);
    expect(response.answer).toBe("Accuracy was 0.92. [1]");
    expect(response.diagnostics.validation).toMatchObject({ method: "provider-review", attempts: 2 });
    expect(start).toHaveBeenCalledTimes(4);
    expect(start.mock.calls.every(([input]) => input.providerId === request.providerId && input.model === request.model)).toBe(true);
    const trace = JSON.parse(fs.readFileSync(repo.resolve(`.litagent/cache/provider-runs/${response.runId}/qa-validation.json`), "utf8"));
    expect(trace[0].issues.join(" ")).toContain("not 0.99");
    expect(trace[1].issues).toEqual([]);
  });

  it("rejects reversed negation without relabeling a validation failure as not_found", async () => {
    const { engine, request, start } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input, false, "The passage says the detector does not require cloud access.")
      : draftReply([{ text: "The detector requires cloud access.", kind: "reported", passageIds: [contextIds(input)[0]!] }]),
    "# Deployment\n\nThe detector does not require cloud access.");
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("after one repair attempt");
    expect(start).toHaveBeenCalledTimes(4);
    expect(engine.readQaThread(request).messages).toEqual([]);
    expect(engine.listRuns()[0]?.status).toBe("failed");
  });

  it("rejects an out-of-scope passage without substituting another source", async () => {
    const { engine, request, start, repo } = fixture(() => draftReply([{
      text: "Accuracy was 0.92.", kind: "reported", passageIds: [foreignId]
    }]));
    const other = repo.importPaper({ metadata: { title: "Unselected study" } }).paper;
    repo.writeMarkdown(other.id, "# Results\n\nAccuracy was 0.92.");
    const foreignId = repo.readPassages(other.id)[0]!.id;
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("after one repair attempt");
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls.every(([input]) => !input.prompt.startsWith("LitAgent Q&A source review"))).toBe(true);
  });

  it("requires a verdict for every claim exactly once", async () => {
    const { engine, request } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? { transcript: JSON.stringify({ supported: true, reason: "Looks right", claims: [] }) }
      : draftReply([{ text: "Accuracy was 0.92.", kind: "reported", passageIds: [contextIds(input)[0]!] }]));
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("every claim exactly once");
  });

  it("preserves more than five independently sourced claims", async () => {
    const markdown = Array.from({ length: 6 }, (_, index) => `# Experiment ${index + 1}\n\nExperiment ${index + 1} used ${index + 2} sensors.`).join("\n\n");
    const { engine, request } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input)
      : draftReply(contextIds(input).map((id, index) => ({
        text: `Experiment ${index + 1} used ${index + 2} sensors.`, kind: "reported", passageIds: [id]
      }))), markdown);
    const response = await engine.answerQuestionWithProvider(request);
    expect(response.evidence).toHaveLength(6);
    expect(response.answer).toContain("Experiment 6 used 7 sensors. [6]");
  });

  it("repairs a premature not-found answer with an explicitly labeled deduction", async () => {
    const { engine, request, start } = fixture((input) => {
      if (input.prompt.startsWith("LitAgent Q&A source review")) {
        const { draft, markdownContext } = reviewInput(input);
        if (draft.status === "not_found") {
          expect(markdownContext).toContain("future frames");
          return reviewReply(input, false, "An offline inference follows from future-frame access.");
        }
        return reviewReply(input);
      }
      return input.prompt.includes("Repair the following draft once") ? draftReply([{
        text: "Offline: the detector needs future frames unavailable to a causal live process.",
        kind: "inference", passageIds: contextIds(input)
      }]) : draftReply([]);
    }, "# Methods\n\nThe detector uses past and future frames.\n\n# Evaluation\n\nPredictions are computed over complete recordings.");
    const response = await engine.answerQuestionWithProvider({ ...request, question: "Online or offline?" });
    expect(response.answer).toMatch(/^Inference: Offline:/);
    expect(response.evidence).toHaveLength(2);
    expect(start).toHaveBeenCalledTimes(4);
  });

  it("accepts a short sourced negative answer without word-count heuristics", async () => {
    const { engine, request } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input)
      : draftReply([{ text: "No.", kind: "reported", passageIds: contextIds(input) }]),
    "# Deployment\n\nThe detector does not require cloud access.");
    const response = await engine.answerQuestionWithProvider({ ...request, question: "Does it need the cloud?" });
    expect(response.answer).toBe("No. [1]");
  });

  it("only saves a not_found response after reviewing the available sources", async () => {
    const { engine, request, start } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input, true, "Neither source text nor a deduction answers the battery-life question.")
      : draftReply([]));
    const response = await engine.answerQuestionWithProvider({ ...request, question: "What is its battery life?" });
    expect(response.status).toBe("not_found");
    expect(response.evidence).toEqual([]);
    expect(response.diagnostics.validation?.attempts).toBe(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("stops after one repair when a provider cannot produce the answer schema", async () => {
    const { engine, request, start } = fixture(() => ({ transcript: "Accuracy was 0.92. [1]" }));
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("after one repair attempt");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("does not expose a draft when source review fails", async () => {
    const { engine, request } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? { status: "failed", failureClass: "rate_limit" }
      : draftReply([{ text: "Accuracy was 0.92.", kind: "reported", passageIds: contextIds(input) }]));
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("rate_limit");
    expect(engine.readQaThread(request).messages).toEqual([]);
  });

  it("honors cancellation between drafting and review", async () => {
    const { engine, request, start } = fixture((input) => {
      engine.cancelRun(input.runId);
      return draftReply([{ text: "Accuracy was 0.92.", kind: "reported", passageIds: contextIds(input) }]);
    });
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("cancelled");
    expect(start).toHaveBeenCalledTimes(1);
    expect(engine.listRuns()[0]?.status).toBe("cancelled");
  });
});

describe("Q&A source coverage", () => {
  it("never accepts an omitted passage from a truncated document", async () => {
    const markdown = `# Overview\n\nThe detector processes images.\n\n# Background\n\n${"Extended background. ".repeat(11_000)}\n\n# Results\n\nAccuracy was 0.92.`;
    const { engine, request, repo, paper, start } = fixture(() => draftReply([{
      text: "Accuracy was 0.92.", kind: "reported", passageIds: [tailId]
    }]), markdown);
    const tailId = repo.readPassages(paper.id).at(-1)!.id;
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("after one repair attempt");
    expect(start.mock.calls[0]?.[0].prompt).not.toContain(tailId);
    const run = engine.listRuns()[0]!;
    const manifest = JSON.parse(fs.readFileSync(repo.resolve(`.litagent/cache/provider-runs/${run.id}/qa-sources.json`), "utf8"));
    expect(manifest[0]).toMatchObject({ coverage: "truncated", totalPassages: 3, includedPassages: 1 });
  });

  it("records missing sources and does not claim to have searched them", async () => {
    const { engine, request, repo, paper } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input) : draftReply([]));
    const missing = repo.importPaper({ metadata: { title: "Unconverted study" } }).paper;
    const response = await engine.answerQuestionWithProvider({ ...request, paperId: null, paperIds: [paper.id, missing.id] });
    expect(response.diagnostics.sources).toMatchObject([
      { paperId: paper.id, coverage: "full", includedPassages: 1 },
      { paperId: missing.id, coverage: "missing", includedPassages: 0, markdownHash: null }
    ]);
    expect(response.diagnostics.sources[0]?.markdownHash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.answer).toContain("not a conclusion about all selected sources");
    expect(response.diagnostics.message).toContain("Unconverted study (missing)");
  });

  it("does not cite stale passage text after an external Markdown edit", async () => {
    const { engine, request, repo, paper, start } = fixture();
    fs.writeFileSync(repo.resolve(repo.readPaper(paper.id)!.filePaths.markdown!), "# Results\n\nAccuracy was 0.74.", "utf8");
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("No complete, current passages");
    expect(start).not.toHaveBeenCalled();
  });

  it("includes citation-marker overhead in the context budget", async () => {
    const markdown = Array.from({ length: 3_000 }, (_, index) => `Observation ${index}: the detector processes images.`).join("\n\n");
    const { engine, request } = fixture((input) => input.prompt.startsWith("LitAgent Q&A source review")
      ? reviewReply(input)
      : draftReply([{ text: "The detector processes images.", kind: "reported", passageIds: [contextIds(input)[0]!] }]), markdown, false);
    const response = await engine.answerQuestionWithProvider(request);
    expect(response.diagnostics.contextChars).toBeLessThanOrEqual(180_000);
    expect(response.diagnostics.sources[0]?.coverage).toBe("truncated");
    expect(response.diagnostics.sources[0]?.includedPassages).toBeLessThan(3_000);
    expect(response.diagnostics.retrievedCount).toBe(response.diagnostics.sources[0]?.includedPassages);
  });

  it("does not treat placeholder/demo Markdown as a converted paper", async () => {
    const { engine, request, start } = fixture(undefined, "# Demo\n\nRun the Marker conversion workflow to replace this placeholder.");
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow(/conversion/i);
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects answers if a source is reconverted while review is running", async () => {
    const { engine, request, repo, paper } = fixture((input) => {
      if (!input.prompt.startsWith("LitAgent Q&A source review")) return draftReply([{
        text: "Accuracy was 0.92.", kind: "reported", passageIds: contextIds(input)
      }]);
      repo.writeMarkdown(paper.id, "# Results\n\nAccuracy was 0.74.");
      return reviewReply(input);
    });
    await expect(engine.answerQuestionWithProvider(request)).rejects.toThrow("Source Markdown changed");
    expect(engine.readQaThread(request).messages).toEqual([]);
  });
});
