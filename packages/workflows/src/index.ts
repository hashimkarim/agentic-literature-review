import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import { AgentProviderCatalog } from "@litagent/agents";
import {
  EvidenceRefSchema,
  NormalizedRunEventSchema,
  QaRequestSchema,
  QaResponseSchema,
  WorkflowRunSchema,
  WorkflowTypeSchema,
  type EvidenceRef,
  type NormalizedRunEvent,
  type Paper,
  type QaRequestInput,
  type QaResponse,
  type WorkflowRun,
  type WorkflowType
} from "@litagent/contracts";
import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository, createId, nowIso, parseMarkdownPassages, slugify } from "@litagent/library";

export const WorkflowStartRequestSchema = z.object({
  type: WorkflowTypeSchema,
  projectId: z.string().nullable().default(null),
  paperIds: z.array(z.string()).default([]),
  collectionIds: z.array(z.string()).default([]),
  query: z.string().nullable().default(null),
  providerId: z.string().default("local-heuristic")
});
export type WorkflowStartRequest = z.infer<typeof WorkflowStartRequestSchema>;

function event(input: {
  runId: string;
  providerId: string;
  type: NormalizedRunEvent["type"];
  message?: string;
  payload?: Record<string, unknown>;
}): NormalizedRunEvent {
  return NormalizedRunEventSchema.parse({
    id: `event_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    runId: input.runId,
    providerId: input.providerId,
    type: input.type,
    timestamp: nowIso(),
    message: input.message ?? "",
    payload: input.payload ?? {}
  });
}

function appendEvent(filePath: string, runEvent: NormalizedRunEvent): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(runEvent)}\n`, "utf8");
}

function readEvents(filePath: string): NormalizedRunEvent[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => NormalizedRunEventSchema.parse(JSON.parse(line)));
}

function collectPapers(repo: LitAgentRepository, request: WorkflowStartRequest): Paper[] {
  const explicitIds = new Set(request.paperIds);
  if (explicitIds.size > 0) {
    return [...explicitIds]
      .map((paperId) => repo.readPaper(paperId))
      .filter((paper): paper is Paper => Boolean(paper));
  }
  if (request.projectId) {
    let entries = repo.listPapers(request.projectId);
    if (request.collectionIds.length > 0) {
      const collectionPaperIds = new Set(
        request.collectionIds.flatMap((collectionId) => {
          const collection = repo.readCollection(request.projectId ?? "", collectionId);
          return collection?.paperIds ?? [];
        })
      );
      entries = entries.filter((entry) => collectionPaperIds.has(entry.paper.id));
    }
    return entries.map((entry) => entry.paper);
  }
  return repo.listGlobalPapers();
}

function scoreRelevance(paper: Paper, query: string): number {
  const haystack = `${paper.title} ${paper.authors.join(" ")} ${paper.tags.join(" ")}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3);
  if (terms.length === 0) return 0.5;
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

function metadataPatchFor(paper: Paper): Record<string, unknown> {
  return {
    paperId: paper.id,
    proposed: {
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      tags: paper.tags,
      missing: {
        doi: !paper.doi,
        arxivId: !paper.arxivId,
        zoteroKey: !paper.zoteroKey
      }
    },
    status: "proposal"
  };
}

function ensureMarkdownFallback(repo: LitAgentRepository, paper: Paper): string {
  const existing = repo.readMarkdown(paper.id);
  if (existing) return existing;
  const markdown = [
    `# ${paper.title}`,
    "",
    "Markdown conversion has not been run yet.",
    "",
    "## Metadata",
    "",
    `Authors: ${paper.authors.join(", ") || "Unknown"}`,
    paper.year ? `Year: ${paper.year}` : "Year: unknown",
    "",
    "## Evidence",
    "",
    "Run the Marker conversion workflow to replace this placeholder with extracted reading text."
  ].join("\n");
  repo.writeMarkdown(paper.id, markdown);
  return markdown;
}

function findMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...findMarkdownFiles(fullPath));
    else if (entry.name.endsWith(".md")) out.push(fullPath);
  }
  return out;
}

function rewriteAssetLinks(markdown: string, sourceDir: string, assetDir: string): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt: string, target: string) => {
    if (target.includes("://") || target.startsWith("data:") || target.startsWith("#")) return full;
    const sourceAsset = path.resolve(sourceDir, decodeURIComponent(target));
    if (!fs.existsSync(sourceAsset) || !fs.statSync(sourceAsset).isFile()) return full;
    fs.mkdirSync(assetDir, { recursive: true });
    const destination = path.join(assetDir, path.basename(sourceAsset));
    fs.copyFileSync(sourceAsset, destination);
    return `![${alt}](assets/${path.basename(destination)})`;
  });
}

export interface ConversionResult {
  status: "ok" | "placeholder" | "failed";
  markdownPath: string | null;
  passageCount: number;
  message: string;
}

export function convertPaperWithMarker(repo: LitAgentRepository, paperId: string): ConversionResult {
  const paper = repo.readPaper(paperId);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);
  const pdfPath = repo.pdfPath(paperId);
  if (!pdfPath) {
    const markdown = ensureMarkdownFallback(repo, paper);
    return {
      status: "placeholder",
      markdownPath: repo.readPaper(paperId)?.filePaths.markdown ?? null,
      passageCount: parseMarkdownPassages(paperId, markdown).length,
      message: "No PDF is attached; wrote placeholder Markdown."
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-marker-"));
  const command = [
    "--from",
    "marker-pdf",
    "marker_single",
    pdfPath,
    "--output_dir",
    tmpDir,
    "--output_format",
    "markdown",
    "--disable_multiprocessing",
    "--disable_tqdm",
    "--layout_batch_size",
    "1",
    "--detection_batch_size",
    "1",
    "--recognition_batch_size",
    "1",
    "--equation_batch_size",
    "1"
  ];
  const marker = spawnSync("uvx", command, {
    cwd: repo.root,
    env: { ...process.env, PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF ?? "expandable_segments:True" },
    encoding: "utf8"
  });
  if (marker.status !== 0) {
    return {
      status: "failed",
      markdownPath: paper.filePaths.markdown,
      passageCount: repo.readPassages(paperId).length,
      message: `Marker failed: ${(marker.stderr || marker.stdout || "").trim()}`
    };
  }
  const markdownFile = findMarkdownFiles(tmpDir)[0];
  if (!markdownFile) {
    return {
      status: "failed",
      markdownPath: paper.filePaths.markdown,
      passageCount: repo.readPassages(paperId).length,
      message: "Marker finished but did not write a Markdown file."
    };
  }
  const raw = fs.readFileSync(markdownFile, "utf8");
  const markdownDir = repo.resolve(`library/markdown/${paperId}`);
  const rewritten = rewriteAssetLinks(raw, path.dirname(markdownFile), path.join(markdownDir, "assets"));
  const result = repo.writeMarkdown(paperId, rewritten);
  return {
    status: "ok",
    markdownPath: result.markdownPath,
    passageCount: result.passages.length,
    message: "Converted PDF with Marker."
  };
}

export class WorkflowEngine {
  constructor(
    private readonly repo: LitAgentRepository,
    private readonly index: SearchIndex,
    private readonly providers = new AgentProviderCatalog()
  ) {}

  answerQuestion(input: QaRequestInput): QaResponse {
    const parsed = QaRequestSchema.parse(input);
    const results = this.index.search(this.repo, {
      query: parsed.question,
      projectId: parsed.projectId,
      paperId: parsed.paperId,
      limit: 5
    });
    const evidence: EvidenceRef[] = results
      .filter((result) => result.passage)
      .slice(0, 3)
      .map((result, index) =>
        EvidenceRefSchema.parse({
          paperId: result.paper.id,
          passageId: result.passage?.id,
          page: result.passage?.page ?? null,
          quote: result.passage?.quote ?? "",
          confidence: Math.max(0.45, 0.95 - index * 0.12)
        })
      );

    if (evidence.length === 0) {
      return QaResponseSchema.parse({
        answer: "Not found in the selected sources. Try broadening the scope or running Markdown conversion/indexing first.",
        evidence,
        runId: null
      });
    }

    const answer = [
      `The selected sources contain relevant evidence for: "${parsed.question}".`,
      "",
      ...evidence.map((item, index) => {
        const paper = this.repo.readPaper(item.paperId);
        return `${index + 1}. ${paper?.title ?? item.paperId}, p.${item.page ?? "?"}: ${item.quote}`;
      })
    ].join("\n");
    return QaResponseSchema.parse({ answer, evidence, runId: null });
  }

  startWorkflow(input: WorkflowStartRequest): WorkflowRun {
    const parsed = WorkflowStartRequestSchema.parse(input);
    const runId = createId("run");
    const eventsPath = `workflows/${runId}.jsonl`;
    const absoluteEventsPath = this.repo.resolve(eventsPath);
    const timestamp = nowIso();
    let run = WorkflowRunSchema.parse({
      id: runId,
      type: parsed.type,
      projectId: parsed.projectId,
      scope: {
        paperIds: parsed.paperIds,
        collectionIds: parsed.collectionIds,
        query: parsed.query
      },
      providerId: parsed.providerId,
      status: "running",
      eventsPath,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.writeRun(run);
    appendEvent(
      absoluteEventsPath,
      event({
        runId,
        providerId: parsed.providerId,
        type: "run.started",
        message: `Started ${parsed.type}`,
        payload: parsed
      })
    );

    try {
      const payload = this.executeWorkflow(parsed, runId, absoluteEventsPath);
      appendEvent(
        absoluteEventsPath,
        event({
          runId,
          providerId: parsed.providerId,
          type: "artifact.written",
          message: "Workflow artifact written",
          payload
        })
      );
      run = WorkflowRunSchema.parse({ ...run, status: "completed", updatedAt: nowIso() });
    } catch (error) {
      appendEvent(
        absoluteEventsPath,
        event({
          runId,
          providerId: parsed.providerId,
          type: "run.failed",
          message: error instanceof Error ? error.message : String(error)
        })
      );
      run = WorkflowRunSchema.parse({ ...run, status: "failed", updatedAt: nowIso() });
    }

    appendEvent(
      absoluteEventsPath,
      event({
        runId,
        providerId: parsed.providerId,
        type: run.status === "completed" ? "run.completed" : "run.failed",
        message: `Workflow ${run.status}`
      })
    );
    this.writeRun(run);
    return run;
  }

  readRun(runId: string): { run: WorkflowRun; events: NormalizedRunEvent[] } {
    const filePath = this.repo.resolve(`workflows/${runId}.run.json`);
    if (!fs.existsSync(filePath)) throw new Error(`Workflow run not found: ${runId}`);
    const run = WorkflowRunSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return { run, events: readEvents(this.repo.resolve(run.eventsPath)) };
  }

  listRuns(): WorkflowRun[] {
    const dir = this.repo.resolve("workflows");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".run.json"))
      .map((file) => WorkflowRunSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  rebuildIndex(): void {
    this.index.rebuild(this.repo);
  }

  private writeRun(run: WorkflowRun): void {
    fs.mkdirSync(this.repo.resolve("workflows"), { recursive: true });
    fs.writeFileSync(this.repo.resolve(`workflows/${run.id}.run.json`), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }

  private executeWorkflow(
    request: WorkflowStartRequest,
    runId: string,
    absoluteEventsPath: string
  ): Record<string, unknown> {
    const papers = collectPapers(this.repo, request);
    switch (request.type) {
      case "relevance-tagging": {
        const project = request.projectId ? this.repo.readProject(request.projectId) : null;
        const question = request.query ?? project?.researchQuestions[0]?.text ?? "";
        const decisions = papers.map((paper) => {
          const score = scoreRelevance(paper, question);
          const relevanceState = score >= 0.35 ? "maybe" : "excluded";
          if (request.projectId) {
            this.repo.updateProjectLink({
              projectId: request.projectId,
              paperId: paper.id,
              relevanceState,
              projectTags: [`relevance:${relevanceState}`]
            });
          }
          return { paperId: paper.id, title: paper.title, score, relevanceState };
        });
        const outputPath = this.writeProjectOutput(
          request.projectId,
          `relevance-${slugify(runId)}.md`,
          ["# Relevance Tagging", "", ...decisions.map((d) => `- ${d.relevanceState}: ${d.title} (${d.score.toFixed(2)})`)].join("\n")
        );
        return { outputPath, decisions };
      }
      case "metadata-extraction": {
        const patches = papers.map(metadataPatchFor);
        for (const patch of patches) {
          const paperId = String(patch.paperId);
          const patchPath = this.repo.resolve(`library/papers/${paperId}/metadata.patch.json`);
          fs.writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, "utf8");
        }
        return { patches };
      }
      case "ask-with-citations": {
        const qa = this.answerQuestion({
          question: request.query ?? "What does the selected literature say?",
          projectId: request.projectId,
          providerId: request.providerId
        });
        for (const evidence of qa.evidence) {
          appendEvent(
            absoluteEventsPath,
            event({
              runId,
              providerId: request.providerId,
              type: "evidence.found",
              message: evidence.quote,
              payload: evidence
            })
          );
        }
        const outputPath = this.writeProjectOutput(
          request.projectId,
          `qa-${slugify(runId)}.md`,
          `# Cited Answer\n\n${qa.answer}\n`
        );
        return { outputPath, answer: qa.answer, evidence: qa.evidence };
      }
      case "bib-export": {
        if (!request.projectId) throw new Error("BibTeX export requires a project scope.");
        const bibtex = this.repo.exportBibTeX(request.projectId);
        return { outputPath: `exports/${request.projectId}.bib`, bytes: Buffer.byteLength(bibtex) };
      }
      case "compare-papers": {
        const lines = [
          "# Paper Comparison",
          "",
          "| Paper | Year | Tags | Evidence passages |",
          "| --- | ---: | --- | ---: |",
          ...papers.map(
            (paper) =>
              `| ${paper.title} | ${paper.year ?? ""} | ${paper.tags.join(", ")} | ${this.repo.readPassages(paper.id).length} |`
          )
        ];
        const outputPath = this.writeProjectOutput(request.projectId, `comparison-${slugify(runId)}.md`, lines.join("\n"));
        return { outputPath, compared: papers.map((paper) => paper.id) };
      }
      case "key-findings":
      case "synthesis-note":
      case "contradiction-finder":
      case "screening":
      case "dataset-method-extractor":
      case "reproducibility-checklist":
      case "citation-needed":
      case "find-papers": {
        const lines = [
          `# ${request.type}`,
          "",
          `Scope contains ${papers.length} paper(s).`,
          "",
          ...papers.map((paper) => `- ${paper.title}: ${this.repo.readPassages(paper.id)[0]?.quote ?? "No passages indexed yet."}`)
        ];
        const outputPath = this.writeProjectOutput(request.projectId, `${slugify(request.type)}-${slugify(runId)}.md`, lines.join("\n"));
        return { outputPath, paperCount: papers.length };
      }
      default:
        return { status: "unsupported" };
    }
  }

  private writeProjectOutput(projectId: string | null, filename: string, content: string): string {
    const outputPath = projectId ? `projects/${projectId}/outputs/${filename}` : `workflows/${filename}`;
    const absolutePath = this.repo.resolve(outputPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, `${content.trim()}\n`, "utf8");
    return outputPath;
  }

  providerStatus() {
    return this.providers.discover();
  }
}
