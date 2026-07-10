import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AgentHarness, AgentProviderCatalog, type ProviderDefinition } from "@litagent/agents";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";

import { WorkflowEngine, discoverPdfInputs, markerRuntimeStatus, processPdfInbox, processPdfInboxAsync, processPaperSetWithMarker, type ConversionResult } from "./index";

function makeRepo(): LitAgentRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-workflow-test-"));
  const repo = new LitAgentRepository(dir);
  repo.init();
  return repo;
}

function writePdf(filePath: string, label: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `%PDF-1.4\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`, "utf8");
}

function fakeConvert(repo: LitAgentRepository, paperId: string): ConversionResult {
  const paper = repo.readPaper(paperId);
  if (!paper) throw new Error(`Missing paper: ${paperId}`);
  const result = repo.writeMarkdown(
    paperId,
    [
      `# ${paper.title}`,
      "",
      "This converted passage is available for indexed cited answers.",
      "",
      "## Method",
      "",
      "Marker first pass output keeps assets, passages, and local search recoverable."
    ].join("\n")
  );
  return {
    status: "ok",
    markdownPath: result.markdownPath,
    passageCount: result.passages.length,
    message: "fake marker conversion"
  };
}

describe("PDF inbox processing", () => {
  it("prefers configured and bundled Marker runtimes over uvx fallback", () => {
    const previousMarkerBin = process.env.LITAGENT_MARKER_BIN;
    const previousConverterDir = process.env.LITAGENT_CONVERTER_DIR;
    const previousUvxBin = process.env.LITAGENT_UVX_BIN;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-marker-runtime-test-"));
    try {
      const executable = process.platform === "win32" ? "marker_single.exe" : "marker_single";
      const explicitMarker = path.join(dir, executable);
      fs.writeFileSync(explicitMarker, "");
      process.env.LITAGENT_MARKER_BIN = explicitMarker;
      delete process.env.LITAGENT_CONVERTER_DIR;
      expect(markerRuntimeStatus()).toMatchObject({
        available: true,
        source: "env",
        command: explicitMarker
      });

      delete process.env.LITAGENT_MARKER_BIN;
      const bundledMarker = path.join(dir, "marker", "bin", executable);
      fs.mkdirSync(path.dirname(bundledMarker), { recursive: true });
      fs.writeFileSync(bundledMarker, "");
      process.env.LITAGENT_CONVERTER_DIR = dir;
      expect(markerRuntimeStatus()).toMatchObject({
        available: true,
        source: "bundled",
        command: bundledMarker
      });

      delete process.env.LITAGENT_CONVERTER_DIR;
      process.env.LITAGENT_UVX_BIN = path.join(dir, "missing-uvx");
      expect(markerRuntimeStatus()).toMatchObject({
        available: false,
        source: "uvx"
      });
    } finally {
      if (previousMarkerBin === undefined) delete process.env.LITAGENT_MARKER_BIN;
      else process.env.LITAGENT_MARKER_BIN = previousMarkerBin;
      if (previousConverterDir === undefined) delete process.env.LITAGENT_CONVERTER_DIR;
      else process.env.LITAGENT_CONVERTER_DIR = previousConverterDir;
      if (previousUvxBin === undefined) delete process.env.LITAGENT_UVX_BIN;
      else process.env.LITAGENT_UVX_BIN = previousUvxBin;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers PDFs recursively under the user inbox", () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/root.pdf"), "root");
    writePdf(repo.resolve("pdfs/topic/child.pdf"), "child");
    writePdf(repo.resolve("pdfs/topic/deeper/grandchild.PDF"), "grandchild");
    writePdf(repo.resolve("pdfs/node_modules/ignored.pdf"), "ignored");

    const discovered = discoverPdfInputs(repo, { sourceDir: "pdfs" });

    expect(discovered.map((item) => item.relativePath)).toEqual([
      "root.pdf",
      path.join("topic", "child.pdf"),
      path.join("topic", "deeper", "grandchild.PDF")
    ]);
  });

  it("imports, links, converts, writes passages, indexes, and summarizes inbox PDFs", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Inbox project" });
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    writePdf(repo.resolve("pdfs/nested/b.pdf"), "b");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));

    const result = processPdfInbox(
      repo,
      { projectId: project.id, sourceDir: "pdfs", runId: "run_test" },
      {
        convertPaper: fakeConvert,
        indexPaper: (paperId) => {
          const paper = repo.readPaper(paperId);
          if (paper) index.indexPaper(paper, repo.readPassages(paperId));
        }
      }
    );

    expect(result.status).toBe("ok");
    expect(result.discovered).toBe(2);
    expect(result.imported).toBe(2);
    expect(result.converted).toBe(2);
    expect(result.summaryPath).toBe("workflows/run_test.pdf-processing-summary.json");
    expect(fs.existsSync(repo.resolve(result.summaryPath ?? ""))).toBe(true);
    expect(repo.listPaperLinks(project.id)).toHaveLength(2);
    expect(repo.listGlobalPapers().every((paper) => paper.filePaths.markdown)).toBe(true);

    const searchResults = index.search(repo, {
      query: "indexed cited answers",
      projectId: project.id,
      limit: 5
    });
    expect(searchResults[0]?.passage?.quote).toContain("converted passage");
    index.close();
  });

  it("skips existing Markdown unless forced", () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    let conversions = 0;
    const convert = (repository: LitAgentRepository, paperId: string) => {
      conversions += 1;
      return fakeConvert(repository, paperId);
    };

    const first = processPdfInbox(repo, { sourceDir: "pdfs" }, { convertPaper: convert });
    const paperId = first.items[0]?.paperId;
    expect(paperId).toBeTruthy();
    const second = processPdfInbox(repo, { sourceDir: "pdfs" }, { convertPaper: convert });
    const forced = processPaperSetWithMarker(repo, paperId ? [paperId] : [], { force: true }, { convertPaper: convert });

    expect(conversions).toBe(2);
    expect(second.skipped).toBe(1);
    expect(forced.converted).toBe(1);
  });

  it("processes inbox PDFs asynchronously and emits progress", async () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    const progress: string[] = [];

    const result = await processPdfInboxAsync(
      repo,
      { sourceDir: "pdfs", runId: "run_async" },
      {
        convertPaper: async (repository, paperId) => fakeConvert(repository, paperId),
        onProgress: (message) => progress.push(message)
      }
    );

    expect(result.status).toBe("ok");
    expect(result.converted).toBe(1);
    expect(result.summaryPath).toBe("workflows/run_async.pdf-processing-summary.json");
    expect(progress.some((message) => message.includes("Discovered 1 PDF"))).toBe(true);
    expect(progress.some((message) => message.includes("Finished a.pdf"))).toBe(true);
  });
});

describe("relevance proposals", () => {
  it("stages evidence-backed relevance without changing screening state", () => {
    const repo = makeRepo();
    const project = repo.createProject({
      name: "Relevance Project",
      researchQuestion: "Does the method support reliable real-time analysis?"
    });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Reliable Real-time Analysis" }
    });
    repo.writeMarkdown(imported.paper.id, "# Findings\n\nThe proposed method supports reliable real-time analysis on mobile devices.");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const run = engine.startWorkflow({
      type: "relevance-tagging",
      projectId: project.id,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: project.researchQuestions[0]?.text ?? null,
      options: {},
      providerId: "local-heuristic",
      model: null
    });
    const proposals = repo.listRelevanceProposals(project.id, { paperId: imported.paper.id });

    expect(run.status).toBe("completed");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "pending", paperId: imported.paper.id });
    expect(proposals[0]?.evidence.length).toBeGreaterThan(0);
    expect(repo.listPaperLinks(project.id)[0]?.relevanceState).toBe("unreviewed");
    expect(engine.readRun(run.id).events.some((item) => item.type === "evidence.found")).toBe(true);
    index.close();
  });

  it("turns structured provider output into reviewable relevance proposals", async () => {
    const repo = makeRepo();
    const project = repo.createProject({
      name: "Provider Screening",
      researchQuestion: "Does the paper improve cited research workflows?"
    });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Cited Research Workflows" }
    });
    const { passages } = repo.writeMarkdown(
      imported.paper.id,
      "# Findings\n\nThe workflow links generated claims to exact supporting passages."
    );
    const providerOutput = JSON.stringify({
      proposals: [{
        paperId: imported.paper.id,
        proposedState: "included",
        relevanceScore: 0.92,
        confidence: 0.88,
        rationale: "The paper directly improves cited research workflows.",
        projectTags: ["cited-workflows"],
        evidencePassageIds: [passages[0]?.id]
      }]
    });
    const fakeProvider: ProviderDefinition = {
      id: "fake-relevance",
      label: "Fake Relevance Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => ["-e", `process.stdout.write(${JSON.stringify(providerOutput)})`],
      promptDelivery: "stdin"
    };
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const catalog = new AgentProviderCatalog([fakeProvider]);
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const run = engine.startWorkflow({
      type: "relevance-tagging",
      projectId: project.id,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: project.researchQuestions[0]?.text ?? null,
      options: {},
      providerId: fakeProvider.id,
      model: null
    });

    let completed = engine.readRun(run.id).run;
    for (let attempt = 0; attempt < 100 && completed.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = engine.readRun(run.id).run;
    }
    const proposals = repo.listRelevanceProposals(project.id, { paperId: imported.paper.id });

    expect(completed.status).toBe("completed");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      providerId: fakeProvider.id,
      proposedState: "included",
      status: "pending"
    });
    expect(proposals[0]?.evidence[0]?.passageId).toBe(passages[0]?.id);
    expect(repo.listPaperLinks(project.id)[0]?.relevanceState).toBe("unreviewed");
    index.close();
  });
});

describe("RAG question answering", () => {
  it("answers with scoped evidence refs and diagnostics", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "QA Project" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Real-time Systems", authors: ["Tester"], year: 2026 }
    });
    repo.writeMarkdown(
      imported.paper.id,
      [
        "# Findings",
        "",
        "Low latency streaming inference makes real-time music analysis reliable on mobile devices.",
        "",
        "Batch-only models are less appropriate for interactive listening workflows."
      ].join("\n")
    );
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const answer = engine.answerQuestion({
      question: "What makes real-time music analysis reliable?",
      projectId: project.id,
      providerId: "local-heuristic"
    });

    expect(answer.status).toBe("answered");
    expect(answer.scope.type).toBe("project");
    expect(answer.scope.paperCount).toBe(1);
    expect(answer.diagnostics.retrievedCount).toBeGreaterThan(0);
    expect(answer.evidence[0]).toMatchObject({
      paperId: imported.paper.id,
      paperTitle: "Real-time Systems",
      section: "Findings"
    });
    expect(answer.answer).toContain("[1]");
    expect(answer.answer).toContain("real-time music analysis");
    index.close();
  });

  it("returns not found when selected paper scope has no supporting passage", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Selected QA" });
    const relevant = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Relevant Paper" }
    });
    const unrelated = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Unrelated Paper" }
    });
    repo.writeMarkdown(relevant.paper.id, "# Findings\n\nSymbolic retrieval supports cited answers.");
    repo.writeMarkdown(unrelated.paper.id, "# Findings\n\nThis paper only discusses metadata cleanup.");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const answer = engine.answerQuestion({
      question: "What supports cited answers?",
      projectId: project.id,
      paperId: unrelated.paper.id
    });

    expect(answer.status).toBe("not_found");
    expect(answer.evidence).toHaveLength(0);
    expect(answer.scope.type).toBe("paper");
    expect(answer.scope.paperIds).toEqual([unrelated.paper.id]);
    expect(answer.answer).toContain("Not found in the selected sources");
    index.close();
  });

  it("ask-with-citations workflow honors selected paper ids", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Workflow QA" });
    const first = repo.importPaper({ projectId: project.id, metadata: { title: "First Paper" } });
    const second = repo.importPaper({ projectId: project.id, metadata: { title: "Second Paper" } });
    repo.writeMarkdown(first.paper.id, "# Findings\n\nCited answers use passage evidence from the first paper.");
    repo.writeMarkdown(second.paper.id, "# Findings\n\nThis second paper discusses unrelated exports.");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const run = engine.startWorkflow({
      type: "ask-with-citations",
      projectId: project.id,
      paperIds: [first.paper.id],
      collectionIds: [],
      query: "How do cited answers work?",
      options: {},
      providerId: "local-heuristic",
      model: null
    });
    const { events } = engine.readRun(run.id);
    const evidenceEvent = events.find((event) => event.type === "evidence.found");

    expect(engine.readRun(run.id).run.status).toBe("completed");
    expect(evidenceEvent?.payload.paperId).toBe(first.paper.id);
    expect(evidenceEvent?.payload.paperId).not.toBe(second.paper.id);
    index.close();
  });

  it("can synthesize a cited answer with a selected CLI provider", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Provider QA" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Provider Paper", authors: ["Tester"] }
    });
    repo.writeMarkdown(
      imported.paper.id,
      "# Findings\n\nLow latency streaming inference improves reliable mobile music analysis."
    );
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const fakeProvider: ProviderDefinition = {
      id: "fake",
      label: "Fake Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => [
        "-e",
        "process.stdout.write('Provider synthesis says low latency streaming inference improves reliability [1].')"
      ],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const answer = await engine.answerQuestionWithProvider({
      question: "What improves reliable mobile music analysis?",
      projectId: project.id,
      providerId: "fake"
    });

    expect(answer.status).toBe("answered");
    expect(answer.answer).toContain("Provider synthesis");
    expect(answer.answer).toContain("[1]");
    expect(answer.diagnostics.contextMode).toBe("markdown-context");
    expect(answer.diagnostics.contextChars).toBeGreaterThan(0);
    expect(answer.runId).toMatch(/^run_/);
    const { run, events } = engine.readRun(answer.runId ?? "");
    expect(run.status).toBe("completed");
    expect(events.map((event) => event.type)).toContain("evidence.found");
    expect(events.map((event) => event.type)).toContain("model.delta");
    index.close();
  });

  it("persists questions and answers in a scoped Q&A thread", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Thread QA" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Thread Paper" }
    });
    repo.writeMarkdown(imported.paper.id, "# Findings\n\nPersistent threads keep the question and cited answer together.");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);
    const response = engine.answerQuestion({
      question: "What do persistent threads keep together?",
      projectId: project.id,
      paperId: imported.paper.id
    });

    const recorded = engine.recordQaExchange({ projectId: project.id, paperId: imported.paper.id }, response);
    const loaded = engine.readQaThread({ projectId: project.id, paperId: imported.paper.id });

    expect(recorded.thread.id).toBe(loaded.id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0]).toMatchObject({ role: "user", content: "What do persistent threads keep together?" });
    expect(loaded.messages[1]?.response?.messageId).toBe(loaded.messages[1]?.id);
    expect(loaded.messages[1]?.response?.threadId).toBe(loaded.id);
    index.close();
  });
});
