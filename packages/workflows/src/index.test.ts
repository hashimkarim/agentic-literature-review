import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AgentHarness, AgentProviderCatalog, type ProviderDefinition } from "@litagent/agents";
import { QaResponseSchema, type ResearchRecordKind } from "@litagent/contracts";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";

import { WorkflowEngine, assessMarkdownReadiness, discoverPdfInputs, markerRuntimeStatus, processPdfInbox, processPdfInboxAsync, processPaperSetWithMarker, type ConversionResult } from "./index";

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

describe("metadata proposals", () => {
  it("stages inferred metadata without changing the canonical paper", () => {
    const repo = makeRepo();
    const imported = repo.importPaper({ metadata: { title: "Imported filename" } });
    repo.writeMarkdown(
      imported.paper.id,
      "# Verified Research Title\n\nPublished in 2025. DOI: 10.1234/example.paper\n\n## Abstract\n\nA metadata extraction example."
    );
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const run = engine.startWorkflow({
      type: "metadata-extraction",
      projectId: null,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: null,
      options: {},
      providerId: "local-heuristic",
      model: null
    });
    const proposals = repo.listMetadataProposals(imported.paper.id);

    expect(run.status).toBe("completed");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.fields.map((field) => field.field)).toEqual(expect.arrayContaining(["title", "doi", "year"]));
    expect(repo.readPaper(imported.paper.id)).toMatchObject({ title: "Imported filename", doi: null, year: null });
    index.close();
  });

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
    const fakeProvider: ProviderDefinition = {
      id: "fake-metadata",
      label: "Fake Metadata Agent",
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
  it("stages typed local research items with exact passage evidence", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Research Records" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Evaluation Paper" }
    });
    repo.writeMarkdown(
      imported.paper.id,
      [
        "# Method",
        "",
        "The method uses a convolutional model with streaming inference.",
        "",
        "## Results",
        "",
        "Evaluation accuracy improves by five percentage points on the benchmark dataset.",
        "",
        "## Limitations",
        "",
        "The evaluation is limited to a single benchmark dataset."
      ].join("\n")
    );
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
    index.rebuild(repo);
    const engine = new WorkflowEngine(repo, index);

    const run = engine.startWorkflow({
      type: "key-findings",
      projectId: project.id,
      paperIds: [imported.paper.id],
      collectionIds: [],
      query: null,
      options: {},
      providerId: "local-heuristic",
      model: null
    });
    const proposals = repo.listResearchFindingProposals(imported.paper.id);

    expect(run.status).toBe("completed");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.items.map((item) => item.kind)).toEqual(expect.arrayContaining(["method", "result", "limitation"]));
    expect(proposals[0]?.items.every((item) => item.evidence.length > 0)).toBe(true);
    expect(repo.listResearchRecords(imported.paper.id)).toHaveLength(0);
    index.close();
  });

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
    const fakeProvider: ProviderDefinition = {
      id: "fake-findings",
      label: "Fake Findings Agent",
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
  it("builds and reviews a cited matrix from accepted records", () => {
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
    const engine = new WorkflowEngine(repo, index);

    const run = engine.startWorkflow({
      type: "compare-papers",
      projectId: project.id,
      paperIds: [first.paper.id, second.paper.id],
      collectionIds: [],
      query: "Which model performs better?",
      options: {},
      providerId: "local-heuristic",
      model: null
    });
    const artifact = engine.listComparisonArtifacts(project.id)[0];
    const resultRow = artifact?.rows.find((row) => row.kind === "result");
    const datasetRow = artifact?.rows.find((row) => row.kind === "dataset");

    expect(run.status).toBe("completed");
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-comparison",
      label: "Fake Comparison Agent",
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
    const catalog = new AgentProviderCatalog([fakeProvider]);
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
    const localEngine = new WorkflowEngine(repo, index);
    localEngine.startWorkflow({
      type: "compare-papers",
      projectId: project.id,
      paperIds: [first.paper.id, second.paper.id],
      collectionIds: [],
      query: "How do the methods differ?",
      options: {},
      providerId: "local-heuristic",
      model: null
    });
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-synthesis",
      label: "Fake Synthesis Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => ["-e", `process.stdout.write(${JSON.stringify(providerOutput)})`],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-follow-up",
      label: "Fake Follow-up Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => [
        "-e",
        "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(input.includes('What context is described?')?'Conversation context enables precise follow-up questions [1].':'Not found in the selected sources.'))"
      ],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
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
      providerId: "fake-follow-up"
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-inference",
      label: "Fake Inference Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => [
        "-e",
        `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(input.includes('Reasonable source-grounded deductions are allowed and expected')&&!input.includes('Assistant: Not found in the selected sources.')?'Inference: the model is likely offline/non-causal, not online. It uses connections both forwards and backwards in time and is trained on full sequences. [[passage:${approachPassage?.id}]] [[passage:${trainingPassage?.id}]]':'Not found in the selected sources.'))`
      ],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
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
        "The method uses a transformer encoder to classify streaming audio frames.",
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-addressed-evidence",
      label: "Fake Addressed Evidence Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => [
        "-e",
        `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>process.stdout.write(input.includes('Summarize both findings')?'A transformer encoder classifies streaming audio frames with a score of 0.841. [[passage:${methodPassage?.id}]] Battery consumption constrains mobile deployment. [[passage:${limitationPassage?.id}]]':input.includes('limits mobile deployment')?'Battery consumption constrains mobile deployment. [[passage:${limitationPassage?.id}]]':'A transformer encoder classifies streaming audio frames. [[passage:${methodPassage?.id}]]'))`
      ],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
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
    expect(combinedAnswer.answer).toBe("A transformer encoder classifies streaming audio frames with a score of 0.841. [1] Battery consumption constrains mobile deployment. [2]");
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
    const fakeProvider: ProviderDefinition = {
      id: "fake-unsupported-evidence",
      label: "Fake Unsupported Evidence Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream", "research"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => ["-e", `process.stdout.write('Ocean temperature trends determine coastal erosion. [[passage:${passage?.id}]]')`],
      promptDelivery: "stdin"
    };
    const catalog = new AgentProviderCatalog([fakeProvider]);
    const engine = new WorkflowEngine(repo, index, catalog, new AgentHarness({ catalog }));

    const answer = await engine.answerQuestionWithProvider({
      question: "What determines coastal erosion?",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: fakeProvider.id
    });

    expect(answer.status).toBe("not_found");
    expect(answer.evidence).toEqual([]);
    expect(answer.answer).toBe("Not found in the selected sources.");
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
