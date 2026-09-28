import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentHarness } from "@litagent/agents";
import { AgenticDriverCatalog } from "@litagent/agents/agenticdriver";
import { AgentProviderSettingsSchema } from "@litagent/contracts";
import { AgenticDriver } from "@agenticdriver/sdk";
import { AgenticClient } from "@agenticdriver/sdk/client";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { QaResponseSchema, type ResearchRecordKind } from "@litagent/contracts";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";

import { WorkflowEngine, assessMarkdownReadiness, discoverPdfInputs, markerRuntimeStatus, processPdfInbox, processPdfInboxAsync, processPaperSetWithMarker, type ConversionResult } from "./index";
import type { ProviderQaDraft } from "./qa-grounding";

const driverClosers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of driverClosers.splice(0)) await close(); });

async function driverFixture(instance: string, reply: (prompt: string) => string) {
  const mock = mockProvider((request) => ({ text: reply(request.messages.at(-1)?.content ?? "") }));
  const adapter = { ...mock, info: { ...mock.info, id: instance } };
  const token = "workflow-fixture-token-with-32-characters";
  const server = await serve(new AgenticDriver({ providers: [adapter] }), { port: 0, tokens: [{ token, subject: "workflow-fixture", providers: [instance] }] });
  driverClosers.push(server.close);
  const client = new AgenticClient({ url: server.url, token });
  const id = `driver.${instance}`;
  const settings = AgentProviderSettingsSchema.parse({ providerId: id, enabled: true, defaultModel: "demo", updatedAt: new Date().toISOString() });
  return { id, catalog: new AgenticDriverCatalog(client, await client.providers(), { [id]: settings }) };
}

function comparisonReply(repo: LitAgentRepository, paperIds: string[]): string {
  const kinds: ResearchRecordKind[] = ["finding", "method", "dataset", "result", "limitation", "reproducibility"];
  return JSON.stringify({ title: "Comparison", summary: "Comparison of accepted records.", rows: kinds.map((kind) => ({ kind,
    cells: paperIds.map((paperId) => {
      const records = repo.listResearchRecords(paperId).filter((record) => record.kind === kind);
      return { paperId, status: records.length ? "supported" : "not_found", summary: records.map((record) => record.content).join(" ") || "Not found", recordIds: records.map((record) => record.id) };
    })
  })) });
}

async function waitForRun(engine: WorkflowEngine, runId: string) {
  for (let i = 0; i < 100 && engine.readRun(runId).run.status === "running"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(engine.readRun(runId).run.status).toBe("completed");
}

function qaProviderReply(prompt: string, claims: ProviderQaDraft["claims"], supported = true): string {
  const passages: Array<{ passageId: string; quote: string }> = prompt.startsWith("LitAgent Q&A source review")
    ? JSON.parse(prompt.split("Review input (JSON):\n")[1]!.split("\n\nSupplied context (data):\n")[0]!).passages : [];
  const reply = prompt.startsWith("LitAgent Q&A source review")
    ? { supported, reason: supported ? "The supplied sources support the answer." : "The source is about a different subject.", claims: claims.map((claim, index) => ({ index, supported, scopeSupported: supported, reason: "Compared to the cited passage.",
      evidence: passages.filter((p) => claim.passageIds.includes(p.passageId)).map(({ passageId, quote }) => ({ passageId, quote })) })) }
    : { status: claims.length ? "answered" : "not_found", claims };
  return JSON.stringify(reply);
}

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

function acceptResearchRecord(
  repo: LitAgentRepository,
  input: { projectId: string; paperId: string; kind: ResearchRecordKind; title: string; content: string; passageId: string }
) {
  const paper = repo.readPaper(input.paperId);
  const passage = repo.readPassages(input.paperId).find((candidate) => candidate.id === input.passageId);
  if (!paper || !passage) throw new Error("Comparison test fixture is missing its paper or passage.");
  const proposal = repo.createResearchFindingProposal({
    runId: `run_${input.kind}_${input.paperId}`,
    projectId: input.projectId,
    paperId: input.paperId,
    providerId: "test-provider",
    items: [{
      id: `item_${input.kind}_${input.paperId}`,
      kind: input.kind,
      title: input.title,
      content: input.content,
      attributes: {},
      confidence: 0.9,
      evidence: [{
        paperId: input.paperId,
        passageId: passage.id,
        page: passage.page,
        paperTitle: paper.title,
        section: passage.section,
        quote: passage.quote,
        confidence: 0.9
      }]
    }]
  });
  repo.reviewResearchFindingProposal(input.paperId, proposal.id, { decision: "accepted" });
  const record = repo.listResearchRecords(input.paperId, input.projectId).find((candidate) => candidate.sourceProposalId === proposal.id);
  if (!record) throw new Error("Comparison test fixture did not create an accepted record.");
  return record;
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

  it("does not treat citation-demo Markdown as a completed conversion", () => {
    const repo = makeRepo();
    const imported = repo.importPaper({ metadata: { title: "Placeholder paper" } });
    repo.writeMarkdown(
      imported.paper.id,
      "# Abstract\n\nThis passage is a literal abstract excerpt used for the local citation demo."
    );
    let conversions = 0;

    const result = processPaperSetWithMarker(
      repo,
      [imported.paper.id],
      {},
      {
        convertPaper: (repository, paperId) => {
          conversions += 1;
          return fakeConvert(repository, paperId);
        }
      }
    );

    expect(assessMarkdownReadiness("This passage is a literal abstract excerpt used for the local citation demo.", 1).status).toBe("placeholder");
    expect(conversions).toBe(1);
    expect(result.converted).toBe(1);
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
  it.each(["codex", "claude", "gemini", "local-heuristic", ""])("requires explicit Driver replacement for %s without creating a run", (providerId) => {
    const repo = makeRepo();
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const engine = new WorkflowEngine(repo, index);
    try {
      expect(() => engine.startWorkflow({ type: "relevance-tagging", projectId: null, paperIds: [], collectionIds: [], query: "Relevance?", options: {}, providerId, model: null })).toThrow(/AgenticDriver/);
      expect(engine.listRuns()).toHaveLength(0);
    } finally { index.close(); }
  });

  it("exports bibliography locally even when an old provider selection is saved", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Export", defaultProvider: "codex" });
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const engine = new WorkflowEngine(repo, index);
    try {
      const run = engine.startWorkflow({ type: "bib-export", projectId: project.id, paperIds: [], collectionIds: [], query: null, options: {}, providerId: "codex", model: "old-model" });
      expect(run).toMatchObject({ status: "completed", providerId: "local", model: null });
      expect(repo.readProject(project.id)?.defaultProvider).toBe("codex");
      expect(repo.createProject({ name: "New project" }).defaultProvider).toBe("");
    } finally { index.close(); }
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
    const fakeProvider = await driverFixture("fake-relevance", () => providerOutput);
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const catalog = fakeProvider.catalog;
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

describe("metadata proposals", () => {
  it("turns structured provider metadata into field-level proposals", async () => {
    const repo = makeRepo();
    const imported = repo.importPaper({ metadata: { title: "Provider Metadata Paper" } });
    const { passages } = repo.writeMarkdown(imported.paper.id, "# Provider Metadata Paper\n\nAda Example authored this paper in 2024.");
    const providerOutput = JSON.stringify({
      proposals: [{
        paperId: imported.paper.id,
        fields: [{
          field: "authors",
          proposedValue: ["Ada Example"],
          confidence: 0.91,
          rationale: "The author is named in the front matter.",
          evidencePassageIds: [passages[0]?.id]
        }]
      }]
    });
    const fakeProvider = await driverFixture("fake-metadata", () => providerOutput);
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const run = engine.startWorkflow({
      type: "metadata-extraction",
      projectId: null,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: null,
      options: {},
      providerId: fakeProvider.id,
      model: null
    });

    let completed = engine.readRun(run.id).run;
    for (let attempt = 0; attempt < 100 && completed.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = engine.readRun(run.id).run;
    }
    const proposals = repo.listMetadataProposals(imported.paper.id);

    expect(completed.status).toBe("completed");
    expect(proposals[0]).toMatchObject({ providerId: fakeProvider.id, status: "pending" });
    expect(proposals[0]?.fields[0]).toMatchObject({ field: "authors", proposedValue: ["Ada Example"] });
    expect(proposals[0]?.fields[0]?.evidence[0]?.passageId).toBe(passages[0]?.id);
    expect(repo.readPaper(imported.paper.id)?.authors).toEqual([]);
    index.close();
  });
});

describe("structured research findings", () => {
  it("validates provider findings and preserves structured attributes", async () => {
    const repo = makeRepo();
    const imported = repo.importPaper({ metadata: { title: "Provider Findings" } });
    const { passages } = repo.writeMarkdown(
      imported.paper.id,
      "# Results\n\nThe model reaches 91 percent accuracy on the TestSet benchmark."
    );
    const providerOutput = JSON.stringify({
      proposals: [{
        paperId: imported.paper.id,
        items: [{
          kind: "result",
          title: "TestSet accuracy",
          content: "The model reaches 91 percent accuracy on TestSet.",
          attributes: { metric: "accuracy", value: 91, dataset: "TestSet" },
          confidence: 0.94,
          evidencePassageIds: [passages[0]?.id]
        }]
      }]
    });
    const fakeProvider = await driverFixture("fake-findings", () => providerOutput);
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const run = engine.startWorkflow({
      type: "key-findings",
      projectId: null,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: null,
      options: {},
      providerId: fakeProvider.id,
      model: null
    });

    let completed = engine.readRun(run.id).run;
    for (let attempt = 0; attempt < 100 && completed.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = engine.readRun(run.id).run;
    }
    const proposals = repo.listResearchFindingProposals(imported.paper.id);

    expect(completed.status).toBe("completed");
    expect(proposals[0]).toMatchObject({ providerId: fakeProvider.id, status: "pending" });
    expect(proposals[0]?.items[0]).toMatchObject({
      kind: "result",
      attributes: { metric: "accuracy", value: 91, dataset: "TestSet" }
    });
    expect(proposals[0]?.items[0]?.evidence[0]?.passageId).toBe(passages[0]?.id);
    index.close();
  });
});

describe("paper comparison artifacts", () => {
  it("builds and reviews a cited matrix from accepted records", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Comparison Project" });
    const first = repo.importPaper({ projectId: project.id, metadata: { title: "First Model" } });
    const second = repo.importPaper({ projectId: project.id, metadata: { title: "Second Model" } });
    const firstPassages = repo.writeMarkdown(first.paper.id, "# Method\n\nFirst Model uses a convolutional encoder.\n\n# Results\n\nFirst Model reaches 90 percent accuracy.").passages;
    const secondPassages = repo.writeMarkdown(second.paper.id, "# Method\n\nSecond Model uses a transformer encoder.\n\n# Results\n\nSecond Model reaches 93 percent accuracy.").passages;
    acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: first.paper.id,
      kind: "method",
      title: "Convolutional encoder",
      content: "Uses a convolutional encoder.",
      passageId: firstPassages[0]?.id ?? "missing"
    });
    acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: second.paper.id,
      kind: "method",
      title: "Transformer encoder",
      content: "Uses a transformer encoder.",
      passageId: secondPassages[0]?.id ?? "missing"
    });
    const firstResult = acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: first.paper.id,
      kind: "result",
      title: "Accuracy",
      content: "Reaches 90 percent accuracy.",
      passageId: firstPassages[1]?.id ?? "missing"
    });
    acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: second.paper.id,
      kind: "result",
      title: "Accuracy",
      content: "Reaches 93 percent accuracy.",
      passageId: secondPassages[1]?.id ?? "missing"
    });
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const { catalog, id } = await driverFixture("comparison-review", () => comparisonReply(repo, [first.paper.id, second.paper.id]));
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const run = engine.startWorkflow({
      type: "compare-papers",
      projectId: project.id,
      paperIds: [first.paper.id, second.paper.id],
      collectionIds: [],
      query: "Which model performs better?",
      options: {},
      providerId: id,
      model: null
    });
    await waitForRun(engine, run.id);
    const artifact = engine.listComparisonArtifacts(project.id)[0];
    const resultRow = artifact?.rows.find((row) => row.kind === "result");
    const datasetRow = artifact?.rows.find((row) => row.kind === "dataset");

    expect(engine.readRun(run.id).run.status).toBe("completed");
    expect(artifact).toMatchObject({ status: "draft", paperIds: [first.paper.id, second.paper.id] });
    expect(resultRow?.cells.every((cell) => cell.status === "supported")).toBe(true);
    expect(resultRow?.cells[0]?.recordIds).toEqual([firstResult.id]);
    expect(datasetRow?.cells.every((cell) => cell.status === "not_found")).toBe(true);
    expect(datasetRow?.cells.every((cell) => cell.evidence.length === 0)).toBe(true);
    const markdown = fs.readFileSync(repo.resolve(artifact?.outputPath ?? "missing"), "utf8");
    expect(markdown).toContain("| **Results** |");
    expect(markdown).toContain(firstPassages[1]?.id);

    const reviewed = engine.reviewComparisonArtifact(project.id, artifact?.id ?? "missing", {
      decision: "accepted",
      summary: "Reviewed comparison summary.",
      cellSummaries: { [`result:${first.paper.id}`]: "Reviewed first-model result." }
    });
    expect(reviewed).toMatchObject({ status: "accepted", summary: "Reviewed comparison summary." });
    expect(reviewed.rows.find((row) => row.kind === "result")?.cells[0]).toMatchObject({
      summary: "Reviewed first-model result.",
      recordIds: [firstResult.id]
    });
    expect(reviewed.rows.find((row) => row.kind === "result")?.cells[0]?.evidence[0]?.passageId).toBe(firstPassages[1]?.id);
    expect(fs.readFileSync(repo.resolve(reviewed.outputPath), "utf8")).toContain("Status: **accepted**");
    index.close();
  });

  it("validates provider comparison cells against accepted record ids", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Provider Comparison" });
    const first = repo.importPaper({ projectId: project.id, metadata: { title: "Paper A" } });
    const second = repo.importPaper({ projectId: project.id, metadata: { title: "Paper B" } });
    const firstPassage = repo.writeMarkdown(first.paper.id, "# Method\n\nPaper A uses method alpha.").passages[0];
    const secondPassage = repo.writeMarkdown(second.paper.id, "# Method\n\nPaper B uses method beta.").passages[0];
    const firstRecord = acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: first.paper.id,
      kind: "method",
      title: "Method alpha",
      content: "Uses method alpha.",
      passageId: firstPassage?.id ?? "missing"
    });
    const secondRecord = acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: second.paper.id,
      kind: "method",
      title: "Method beta",
      content: "Uses method beta.",
      passageId: secondPassage?.id ?? "missing"
    });
    const kinds: ResearchRecordKind[] = ["finding", "method", "dataset", "result", "limitation", "reproducibility"];
    const providerOutput = JSON.stringify({
      title: "Provider comparison",
      summary: "The papers use different methods.",
      rows: kinds.map((kind) => ({
        kind,
        cells: [first.paper, second.paper].map((paper) => ({
          paperId: paper.id,
          status: kind === "method" ? "supported" : "not_found",
          summary: kind === "method" ? `Reviewed method for ${paper.title}.` : "Not available in accepted records.",
          recordIds: kind === "method" ? [paper.id === first.paper.id ? firstRecord.id : secondRecord.id] : []
        }))
      }))
    });
    const fakeProvider = await driverFixture("fake-comparison", () => providerOutput);
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const run = engine.startWorkflow({
      type: "compare-papers",
      projectId: project.id,
      paperIds: [first.paper.id, second.paper.id],
      collectionIds: [],
      query: null,
      options: {},
      providerId: fakeProvider.id,
      model: null
    });
    let completed = engine.readRun(run.id).run;
    for (let attempt = 0; attempt < 100 && completed.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = engine.readRun(run.id).run;
    }
    const artifact = engine.listComparisonArtifacts(project.id)[0];

    expect(completed.status).toBe("completed");
    expect(artifact).toMatchObject({ title: "Provider comparison", providerId: fakeProvider.id, status: "draft" });
    expect(artifact?.rows.find((row) => row.kind === "method")?.cells.map((cell) => cell.recordIds)).toEqual([
      [firstRecord.id],
      [secondRecord.id]
    ]);
    expect(artifact?.rows.find((row) => row.kind === "method")?.cells.map((cell) => cell.evidence[0]?.passageId)).toEqual([
      firstPassage?.id,
      secondPassage?.id
    ]);
    index.close();
  });
});

describe("synthesis artifacts", () => {
  it("synthesizes an accepted comparison and creates a note only after review", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Synthesis Project" });
    const first = repo.importPaper({ projectId: project.id, metadata: { title: "Paper One" } });
    const second = repo.importPaper({ projectId: project.id, metadata: { title: "Paper Two" } });
    const firstPassage = repo.writeMarkdown(first.paper.id, "# Method\n\nPaper One uses a convolutional encoder.").passages[0];
    const secondPassage = repo.writeMarkdown(second.paper.id, "# Method\n\nPaper Two uses a transformer encoder.").passages[0];
    const firstRecord = acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: first.paper.id,
      kind: "method",
      title: "Convolutional method",
      content: "Uses a convolutional encoder.",
      passageId: firstPassage?.id ?? "missing"
    });
    const secondRecord = acceptResearchRecord(repo, {
      projectId: project.id,
      paperId: second.paper.id,
      kind: "method",
      title: "Transformer method",
      content: "Uses a transformer encoder.",
      passageId: secondPassage?.id ?? "missing"
    });
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const comparisonDriver = await driverFixture("synthesis-comparison", () => comparisonReply(repo, [first.paper.id, second.paper.id]));
    const localEngine = new WorkflowEngine(repo, index, comparisonDriver.catalog, new AgentHarness({ catalog: comparisonDriver.catalog }));
    const comparisonRun = localEngine.startWorkflow({
      type: "compare-papers",
      projectId: project.id,
      paperIds: [first.paper.id, second.paper.id],
      collectionIds: [],
      query: "How do the methods differ?",
      options: {},
      providerId: comparisonDriver.id,
      model: null
    });
    await waitForRun(localEngine, comparisonRun.id);
    const comparison = localEngine.listComparisonArtifacts(project.id)[0];
    expect(comparison).toBeTruthy();
    localEngine.reviewComparisonArtifact(project.id, comparison?.id ?? "missing", { decision: "accepted" });

    const providerOutput = JSON.stringify({
      title: "Method synthesis",
      summary: "The papers use different encoder families.",
      sections: [{
        heading: "Methodological contrast",
        claims: [{
          text: "Paper One uses convolution while Paper Two uses a transformer.",
          recordIds: [firstRecord.id, secondRecord.id]
        }]
      }]
    });
    const fakeProvider = await driverFixture("fake-synthesis", () => providerOutput);
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const run = engine.startWorkflow({
      type: "synthesis-note",
      projectId: project.id,
      paperIds: comparison?.paperIds ?? [],
      collectionIds: [],
      query: comparison?.query ?? null,
      options: { comparisonId: comparison?.id },
      providerId: fakeProvider.id,
      model: null
    });
    let completed = engine.readRun(run.id).run;
    for (let attempt = 0; attempt < 100 && completed.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = engine.readRun(run.id).run;
    }
    const synthesis = engine.listSynthesisArtifacts(project.id)[0];
    const claim = synthesis?.sections[0]?.claims[0];

    expect(completed.status).toBe("completed");
    expect(synthesis).toMatchObject({ status: "draft", comparisonId: comparison?.id, noteId: null });
    expect(claim?.recordIds).toEqual([firstRecord.id, secondRecord.id]);
    expect(claim?.evidence.map((item) => item.passageId)).toEqual([firstPassage?.id, secondPassage?.id]);
    expect(repo.listNotes(project.id)).toHaveLength(0);

    const accepted = engine.reviewSynthesisArtifact(project.id, synthesis?.id ?? "missing", {
      decision: "accepted",
      claimTexts: { [claim?.id ?? "missing"]: "Reviewed synthesis claim." }
    });
    const note = accepted.noteId ? repo.readNote(project.id, accepted.noteId) : null;
    expect(accepted).toMatchObject({ status: "accepted" });
    expect(accepted.noteId).toMatch(/^note_/);
    expect(note?.content).toContain("Reviewed synthesis claim.");
    expect(note?.passageIds).toEqual(expect.arrayContaining([firstPassage?.id, secondPassage?.id]));
    expect(fs.readFileSync(repo.resolve(accepted.outputPath), "utf8")).toContain("Status: **accepted**");
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

  it("can synthesize a cited answer through the SDK adapter", async () => {
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
    const fakeProvider = await driverFixture("fake", (prompt) => qaProviderReply(prompt, [{
        text: "Provider synthesis says low latency streaming inference improves reliability.",
        kind: "reported", passageIds: [repo.readPassages(imported.paper.id)[0]!.id]
      }]));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const answer = await engine.answerQuestionWithProvider({
      question: "What improves reliable mobile music analysis?",
      projectId: project.id,
      providerId: fakeProvider.id
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
    expect(events.map((event) => event.type)).toContain("tool.call");
    expect(answer.diagnostics.validation?.method).toBe("provider-review");
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

  it("includes recent thread messages when answering a follow-up question", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Follow-up QA" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Follow-up Paper" }
    });
    repo.writeMarkdown(
      imported.paper.id,
      "# Findings\n\nConversation context enables precise follow-up questions while paper passages remain the evidence source."
    );
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const fakeProvider = await driverFixture("fake-follow-up", (prompt) => qaProviderReply(prompt, prompt.includes("What context is described?") ? [{
        text: "Conversation context enables precise follow-up questions.", kind: "reported",
        passageIds: [repo.readPassages(imported.paper.id)[0]!.id]
      }] : []));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const first = engine.answerQuestion({
      question: "What context is described?",
      projectId: project.id,
      paperId: imported.paper.id
    });
    engine.recordQaExchange({ projectId: project.id, paperId: imported.paper.id }, first);

    const followUp = await engine.answerQuestionWithProvider({
      question: "What does that enable?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });

    expect(followUp.status).toBe("answered");
    expect(followUp.answer).toContain("precise follow-up questions");
    expect(followUp.evidence).toHaveLength(1);
    index.close();
  });

  it("permits cited deductions without reinforcing earlier not-found answers", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Inference QA" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Inference Paper" }
    });
    repo.writeMarkdown(
      imported.paper.id,
      [
        "# Approach",
        "",
        "The temporal model uses multiple connections both forwards and backwards in time at different time scales.",
        "",
        "# Training",
        "",
        "The model is trained on full sequences with a batch size of one."
      ].join("\n")
    );
    const passages = repo.readPassages(imported.paper.id);
    const approachPassage = passages.find((passage) => passage.section === "Approach");
    const trainingPassage = passages.find((passage) => passage.section === "Training");
    expect(approachPassage).toBeTruthy();
    expect(trainingPassage).toBeTruthy();
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const fakeProvider = await driverFixture("fake-inference", (prompt) => qaProviderReply(prompt,
        (prompt.startsWith("LitAgent Q&A source review") || prompt.includes("Reasonable source-grounded deductions are allowed and expected")) && !prompt.includes("Assistant: Not found in the selected sources.") ? [{
          text: "The model is likely offline/non-causal, not online. It uses connections both forwards and backwards in time and is trained on full sequences.",
          kind: "inference", passageIds: [approachPassage!.id, trainingPassage!.id]
        }] : []));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));
    const earlierBase = engine.answerQuestion({
      question: "Does the paper report deployment latency?",
      projectId: project.id,
      paperId: imported.paper.id
    });
    const earlier = QaResponseSchema.parse({
      ...earlierBase,
      answer: "Not found in the selected sources.",
      evidence: [],
      status: "not_found",
      diagnostics: {
        ...earlierBase.diagnostics,
        evidenceCount: 0
      }
    });
    engine.recordQaExchange({ projectId: project.id, paperId: imported.paper.id }, earlier);

    const answer = await engine.answerQuestionWithProvider({
      question: "Is it an online or offline model?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });

    expect(answer.status).toBe("answered");
    expect(answer.answer).toContain("likely offline/non-causal");
    expect(answer.answer).toContain("[1]");
    expect(answer.answer).toContain("[2]");
    expect(answer.evidence.map((item) => item.passageId)).toEqual([approachPassage?.id, trainingPassage?.id]);
    index.close();
  });

  it("archives a Q&A thread before starting a new chat", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Archived QA" });
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    const engine = new WorkflowEngine(repo, index);
    const response = engine.answerQuestion({
      question: "Will this thread be archived?",
      projectId: project.id
    });
    const recorded = engine.recordQaExchange({ projectId: project.id }, response);

    const fresh = engine.clearQaThread({ projectId: project.id });
    const archiveDir = repo.resolve(".litagent/chat-threads/archive");

    expect(fresh.id).toBe(recorded.thread.id);
    expect(fresh.messages).toEqual([]);
    expect(fs.readdirSync(archiveDir).some((file) => file.startsWith(`${recorded.thread.id}-`))).toBe(true);
    index.close();
  });

  it("links different questions to the provider-selected supporting passages", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Addressed evidence" });
    const imported = repo.importPaper({ projectId: project.id, metadata: { title: "Evidence Paper" } });
    repo.writeMarkdown(
      imported.paper.id,
      [
        "# Method",
        "",
        "The method uses a transformer encoder to classify streaming audio frames with a score of 0.841.",
        "",
        "# Limitations",
        "",
        "Battery consumption constrains mobile deployment during continuous inference."
      ].join("\n")
    );
    const passages = repo.readPassages(imported.paper.id);
    const methodPassage = passages.find((passage) => passage.section === "Method");
    const limitationPassage = passages.find((passage) => passage.section === "Limitations");
    expect(methodPassage).toBeTruthy();
    expect(limitationPassage).toBeTruthy();
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const fakeProvider = await driverFixture("fake-addressed-evidence", (prompt) => qaProviderReply(prompt, prompt.includes("Summarize both findings") ? [
        { text: "A transformer encoder classifies streaming audio frames with a score of 0.841.", kind: "reported", passageIds: [methodPassage!.id] },
        { text: "Battery consumption constrains mobile deployment.", kind: "reported", passageIds: [limitationPassage!.id] }
      ] : prompt.includes("limits mobile deployment") ? [
        { text: "Battery consumption constrains mobile deployment.", kind: "reported", passageIds: [limitationPassage!.id] }
      ] : [{ text: "A transformer encoder classifies streaming audio frames.", kind: "reported", passageIds: [methodPassage!.id] }]));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const methodAnswer = await engine.answerQuestionWithProvider({
      question: "Which encoder classifies the audio frames?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });
    const limitationAnswer = await engine.answerQuestionWithProvider({
      question: "What limits mobile deployment?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });
    const combinedAnswer = await engine.answerQuestionWithProvider({
      question: "Summarize both findings.",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });

    expect(methodAnswer.evidence.map((item) => item.passageId)).toEqual([methodPassage?.id]);
    expect(limitationAnswer.evidence.map((item) => item.passageId)).toEqual([limitationPassage?.id]);
    expect(methodAnswer.evidence[0]?.passageId).not.toBe(limitationAnswer.evidence[0]?.passageId);
    expect(methodAnswer.diagnostics.evidenceMode).toBe("provider-passages");
    expect(limitationAnswer.answer).toContain("[1]");
    expect(combinedAnswer.evidence.map((item) => item.passageId)).toEqual([methodPassage?.id, limitationPassage?.id]);
    expect(combinedAnswer.answer).toBe("A transformer encoder classifies streaming audio frames with a score of 0.841. [1]\n\nBattery consumption constrains mobile deployment. [2]");
    index.close();
  });

  it("rejects a cited passage that does not support the generated claim", async () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Unsupported evidence" });
    const imported = repo.importPaper({ projectId: project.id, metadata: { title: "Unrelated Paper" } });
    repo.writeMarkdown(imported.paper.id, "# Method\n\nA transformer encoder classifies streaming audio frames.");
    const passage = repo.readPassages(imported.paper.id)[0];
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const fakeProvider = await driverFixture("fake-unsupported-evidence", (prompt) => qaProviderReply(prompt, [{
        text: "Ocean temperature trends determine coastal erosion.", kind: "reported", passageIds: [passage!.id]
      }], false));
    const catalog = fakeProvider.catalog;
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    await expect(engine.answerQuestionWithProvider({
      question: "What determines coastal erosion?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    })).rejects.toThrow("after one repair attempt");
    index.close();
  });

  it("revalidates legacy thread evidence against the stored answer claim", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Legacy evidence" });
    const imported = repo.importPaper({ projectId: project.id, metadata: { title: "Legacy Paper" } });
    repo.writeMarkdown(
      imported.paper.id,
      "# Method\n\nA transformer encoder classifies streaming audio frames.\n\n# Limitations\n\nBattery consumption constrains mobile deployment."
    );
    const passages = repo.readPassages(imported.paper.id);
    const methodPassage = passages.find((passage) => passage.section === "Method");
    const limitationPassage = passages.find((passage) => passage.section === "Limitations");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);
    const local = engine.answerQuestion({
      question: "What constrains mobile deployment?",
      projectId: project.id,
      paperId: imported.paper.id
    });
    const legacy = QaResponseSchema.parse({
      ...local,
      answer: "Battery consumption constrains mobile deployment [1].",
      evidence: [{
        paperId: imported.paper.id,
        passageId: methodPassage?.id,
        page: methodPassage?.page,
        paperTitle: imported.paper.title,
        section: methodPassage?.section,
        quote: methodPassage?.quote,
        confidence: 0.9
      }],
      status: "answered",
      diagnostics: {
        ...local.diagnostics,
        contextMode: "markdown-context",
        evidenceMode: "claim-match",
        evidenceVersion: 1
      }
    });
    engine.recordQaExchange({ projectId: project.id, paperId: imported.paper.id }, legacy);

    const migrated = engine.readQaThread({ projectId: project.id, paperId: imported.paper.id });
    const migratedResponse = migrated.messages.find((message) => message.role === "assistant")?.response;

    expect(migratedResponse?.evidence.map((item) => item.passageId)).toEqual([limitationPassage?.id]);
    expect(migratedResponse?.diagnostics.evidenceVersion).toBe(2);
    expect(migratedResponse?.diagnostics.message).toContain("Revalidated");
    index.close();
  });
});
