import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { z } from "zod";

import { AgentHarness, AgentProviderCatalog, type AgentProviderSettingsStore, type ProviderRunResult } from "@litagent/agents";
import {
  EvidenceRefSchema,
  NormalizedRunEventSchema,
  QaRequestSchema,
  QaResponseSchema,
  QaScopeSchema,
  WorkflowRunSchema,
  WorkflowTypeSchema,
  type EvidenceRef,
  type NormalizedRunEvent,
  type Paper,
  type QaRequest,
  type QaRequestInput,
  type QaResponse,
  type QaScope,
  type SearchResult,
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
  options: z.record(z.string(), z.unknown()).default({}),
  providerId: z.string().default("local-heuristic"),
  model: z.string().nullable().default(null)
});
export type WorkflowStartRequest = z.infer<typeof WorkflowStartRequestSchema>;

export const PdfProcessingOptionsSchema = z.object({
  sourceDir: z.string().trim().min(1).default("pdfs"),
  force: z.boolean().default(false),
  limit: z.number().int().positive().optional(),
  only: z.array(z.string()).default([]),
  pauseSeconds: z.number().min(0).max(60).default(0),
  refineWithAgent: z.boolean().default(false)
});
export type PdfProcessingOptions = z.infer<typeof PdfProcessingOptionsSchema>;

export interface PdfDiscoveryItem {
  sourcePath: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface PdfProcessingItem {
  sourcePath: string;
  relativePath: string;
  paperId: string;
  title: string;
  importStatus: "imported" | "updated";
  conversionStatus: ConversionResult["status"] | "skipped";
  markdownPath: string | null;
  passageCount: number;
  message: string;
  seconds: number;
}

export interface PdfProcessingResult {
  status: "ok" | "partial" | "empty";
  sourceDir: string;
  discovered: number;
  imported: number;
  converted: number;
  skipped: number;
  failed: number;
  summaryPath: string | null;
  items: PdfProcessingItem[];
}

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

function resolveQaScope(repo: LitAgentRepository, input: QaRequest): QaScope {
  const explicitIds = new Set<string>();
  if (input.paperId) explicitIds.add(input.paperId);
  for (const paperId of input.paperIds) explicitIds.add(paperId);

  let paperIds: string[];
  let scopeType: QaScope["type"] = "global";

  if (input.projectId) {
    const links = repo.listPaperLinks(input.projectId);
    let projectPaperIds = links.map((link) => link.paperId);
    scopeType = "project";
    if (input.collectionId) {
      const collection = repo.readCollection(input.projectId, input.collectionId);
      const collectionPaperIds = new Set(collection?.paperIds ?? []);
      for (const link of links) {
        if (link.subcollectionIds.includes(input.collectionId)) collectionPaperIds.add(link.paperId);
      }
      projectPaperIds = [...collectionPaperIds];
      scopeType = "collection";
    }
    paperIds = explicitIds.size ? projectPaperIds.filter((paperId) => explicitIds.has(paperId)) : projectPaperIds;
  } else if (input.collectionId) {
    paperIds = [];
    scopeType = "collection";
  } else if (explicitIds.size) {
    paperIds = [...explicitIds];
    scopeType = input.paperId && explicitIds.size === 1 ? "paper" : "selection";
  } else {
    paperIds = repo.listGlobalPapers().map((paper) => paper.id);
  }

  paperIds = paperIds.filter((paperId, index, all) => all.indexOf(paperId) === index && Boolean(repo.readPaper(paperId)));
  if (input.paperId && paperIds.length === 1) scopeType = "paper";
  else if (explicitIds.size > 0 && paperIds.length > 1) scopeType = "selection";

  return QaScopeSchema.parse({
    type: scopeType,
    projectId: input.projectId,
    collectionId: input.collectionId,
    paperId: input.paperId,
    paperIds,
    paperCount: paperIds.length,
    passageCount: paperIds.reduce((count, paperId) => count + repo.readPassages(paperId).length, 0)
  });
}

function buildEvidence(results: SearchResult[], limit: number): EvidenceRef[] {
  return results
    .filter((result) => result.passage)
    .slice(0, limit)
    .map((result, index) =>
      EvidenceRefSchema.parse({
        paperId: result.paper.id,
        passageId: result.passage?.id,
        page: result.passage?.page ?? null,
        paperTitle: result.paper.title,
        section: result.passage?.section ?? "",
        quote: result.passage?.quote ?? "",
        confidence: Math.max(0.4, 0.92 - index * 0.1)
      })
    );
}

function buildExtractiveAnswer(question: string, evidence: EvidenceRef[]): string {
  const terms = questionTerms(question);
  const lines = evidence.map((item, index) => {
    const sentence = bestEvidenceSentence(item.quote, terms);
    const location = [item.paperTitle || item.paperId, item.section || null, item.page ? `p.${item.page}` : null]
      .filter(Boolean)
      .join(", ");
    return `[${index + 1}] ${location}: ${sentence}`;
  });
  return [
    `Found evidence in the selected sources for: "${question}".`,
    "",
    ...lines
  ].join("\n");
}

function questionTerms(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3);
}

function bestEvidenceSentence(quote: string, terms: string[]): string {
  const sentences = quote
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 1 || terms.length === 0) return quote.trim();
  return sentences
    .map((sentence) => ({
      sentence,
      score: terms.filter((term) => sentence.toLowerCase().includes(term)).length
    }))
    .sort((left, right) => right.score - left.score)[0]?.sentence ?? quote.trim();
}

function buildProviderQaPrompt(question: string, evidence: EvidenceRef[]): string {
  const evidenceBlock = evidence
    .map((item, index) => {
      const location = [item.paperTitle || item.paperId, item.section || null, item.page ? `p.${item.page}` : null]
        .filter(Boolean)
        .join(", ");
      return [
        `[${index + 1}] ${location}`,
        `paperId: ${item.paperId}`,
        `passageId: ${item.passageId}`,
        `quote: ${item.quote}`
      ].join("\n");
    })
    .join("\n\n");

  return [
    "You are LitAgent answering a literature-review question from retrieved source passages.",
    "Use only the passages below. Do not inspect files, run tools, or write files.",
    "If the passages do not answer the question, say: Not found in the selected sources.",
    "Every factual claim in your answer must cite one or more evidence numbers like [1] or [2].",
    "Keep the answer concise and avoid adding outside knowledge.",
    "",
    `Question: ${question}`,
    "",
    "Evidence:",
    evidenceBlock
  ].join("\n");
}

function providerFinalText(result: ProviderRunResult): string {
  const artifactText =
    result.artifacts
      .map((artifactPath) => (fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, "utf8") : ""))
      .find((content) => content.trim().length > 0) ?? "";
  return (artifactText || result.transcript).trim();
}

function ensureCitedProviderAnswer(answer: string, evidence: EvidenceRef[]): string {
  const trimmed = answer.trim();
  if (!trimmed || evidence.length === 0 || /\[\d+\]/.test(trimmed)) return trimmed;
  return `${trimmed} [1]`;
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
  return out.sort((a, b) => a.localeCompare(b));
}

function markdownMetrics(markdown: string, assetsCopied: number): Pick<ConversionResult, "lines" | "imageRefs" | "links" | "assetsCopied"> {
  return {
    lines: markdown.split(/\r?\n/).length,
    imageRefs: markdown.match(/!\[[^\]]*\]\([^)]+\)/g)?.length ?? 0,
    links: markdown.match(/\]\([^)]+\)/g)?.length ?? 0,
    assetsCopied
  };
}

function rewriteAssetLinks(markdown: string, sourceDir: string, assetDir: string): { markdown: string; metrics: Pick<ConversionResult, "lines" | "imageRefs" | "links" | "assetsCopied"> } {
  const copied = new Map<string, string>();
  const rewritten = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt: string, target: string) => {
    const trimmed = target.trim();
    if (trimmed.includes("://") || trimmed.startsWith("data:") || trimmed.startsWith("#")) return full;
    const sourceAsset = path.resolve(sourceDir, decodeURIComponent(trimmed));
    if (!fs.existsSync(sourceAsset) || !fs.statSync(sourceAsset).isFile()) return full;
    fs.mkdirSync(assetDir, { recursive: true });
    const cached = copied.get(sourceAsset);
    if (cached) return `![${alt}](${cached})`;

    let destination = path.join(assetDir, path.basename(sourceAsset));
    let counter = 1;
    while (fs.existsSync(destination)) {
      const parsed = path.parse(sourceAsset);
      destination = path.join(assetDir, `${parsed.name}_${counter}${parsed.ext}`);
      counter += 1;
    }
    fs.copyFileSync(sourceAsset, destination);
    const relativeAssetPath = `assets/${path.basename(destination)}`;
    copied.set(sourceAsset, relativeAssetPath);
    return `![${alt}](${relativeAssetPath})`;
  });
  return {
    markdown: rewritten,
    metrics: markdownMetrics(rewritten, copied.size)
  };
}

function clearMarkdownAssets(markdownDir: string): void {
  const assetsDir = path.join(markdownDir, "assets");
  if (fs.existsSync(assetsDir)) fs.rmSync(assetsDir, { recursive: true, force: true });
}

export interface ConversionResult {
  status: "ok" | "placeholder" | "failed";
  markdownPath: string | null;
  passageCount: number;
  message: string;
  lines?: number;
  imageRefs?: number;
  links?: number;
  assetsCopied?: number;
}

const skippedPdfDirs = new Set([
  ".git",
  ".hg",
  ".svn",
  ".litagent",
  ".venv",
  "__pycache__",
  "node_modules",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache"
]);

function resolvePdfSourceDir(repo: LitAgentRepository, sourceDir: string): string {
  const candidate = path.isAbsolute(sourceDir) ? sourceDir : repo.resolve(sourceDir);
  const resolved = path.resolve(candidate);
  const root = path.resolve(repo.root);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`PDF source directory must be inside the research repository: ${sourceDir}`);
  }
  return resolved;
}

function walkPdfFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (skippedPdfDirs.has(entry.name)) continue;
      out.push(...walkPdfFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) out.push(fullPath);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function discoverPdfInputs(repo: LitAgentRepository, input: Partial<PdfProcessingOptions> = {}): PdfDiscoveryItem[] {
  const options = PdfProcessingOptionsSchema.parse(input);
  const sourceRoot = resolvePdfSourceDir(repo, options.sourceDir);
  let pdfs = walkPdfFiles(sourceRoot);
  if (options.only.length > 0) {
    const filters = options.only.map((term) => term.toLowerCase());
    pdfs = pdfs.filter((pdfPath) => filters.some((term) => path.relative(sourceRoot, pdfPath).toLowerCase().includes(term)));
  }
  if (options.limit) pdfs = pdfs.slice(0, options.limit);

  return pdfs.map((sourcePath) => {
    const stat = fs.statSync(sourcePath);
    return {
      sourcePath,
      relativePath: path.relative(sourceRoot, sourcePath),
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString()
    };
  });
}

function titleFromPdfPath(sourcePath: string): string {
  return path.basename(sourcePath, path.extname(sourcePath)).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled paper";
}

function writePdfProcessingSummary(repo: LitAgentRepository, runId: string | null, result: Omit<PdfProcessingResult, "summaryPath">): string {
  const summaryPath = runId ? `workflows/${runId}.pdf-processing-summary.json` : `workflows/pdf-processing-summary.json`;
  const absolutePath = repo.resolve(summaryPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify({ ...result, summaryPath }, null, 2)}\n`, "utf8");
  return summaryPath;
}

export function processPdfInbox(
  repo: LitAgentRepository,
  input: Partial<PdfProcessingOptions> & { projectId?: string | null; runId?: string | null } = {},
  hooks: {
    convertPaper?: (repo: LitAgentRepository, paperId: string) => ConversionResult;
    indexPaper?: (paperId: string) => void;
    onProgress?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): PdfProcessingResult {
  const options = PdfProcessingOptionsSchema.parse(input);
  const projectId = input.projectId ?? null;
  const sourceRoot = resolvePdfSourceDir(repo, options.sourceDir);
  const discovered = discoverPdfInputs(repo, options);
  hooks.onProgress?.(`Discovered ${discovered.length} PDF(s) under ${path.relative(repo.root, sourceRoot) || "."}`, {
    sourceDir: options.sourceDir,
    discovered: discovered.length
  });

  const knownPaperIds = new Set(repo.listGlobalPapers().map((paper) => paper.id));
  const items: PdfProcessingItem[] = [];
  for (const [index, pdf] of discovered.entries()) {
    const start = performance.now();
    hooks.onProgress?.(`Processing PDF ${index + 1}/${discovered.length}: ${pdf.relativePath}`, {
      sourcePath: pdf.sourcePath,
      relativePath: pdf.relativePath
    });
    const imported = repo.importPaper({
      sourcePath: pdf.sourcePath,
      projectId,
      metadata: {
        title: titleFromPdfPath(pdf.sourcePath),
        authors: []
      }
    });
    const paperBeforeConversion = repo.readPaper(imported.paper.id) ?? imported.paper;
    const importStatus = knownPaperIds.has(imported.paper.id) ? "updated" : "imported";
    knownPaperIds.add(imported.paper.id);

    let conversion: ConversionResult;
    if (!options.force && paperBeforeConversion.filePaths.markdown && repo.readMarkdown(imported.paper.id)) {
      conversion = {
        status: "ok",
        markdownPath: paperBeforeConversion.filePaths.markdown,
        passageCount: repo.readPassages(imported.paper.id).length,
        message: "Markdown already exists; skipped conversion."
      };
      hooks.indexPaper?.(imported.paper.id);
      items.push({
        sourcePath: pdf.sourcePath,
        relativePath: pdf.relativePath,
        paperId: imported.paper.id,
        title: imported.paper.title,
        importStatus,
        conversionStatus: "skipped",
        markdownPath: conversion.markdownPath,
        passageCount: conversion.passageCount,
        message: conversion.message,
        seconds: roundSeconds(performance.now() - start)
      });
      continue;
    }

    conversion = (hooks.convertPaper ?? convertPaperWithMarker)(repo, imported.paper.id);
    hooks.indexPaper?.(imported.paper.id);
    items.push({
      sourcePath: pdf.sourcePath,
      relativePath: pdf.relativePath,
      paperId: imported.paper.id,
      title: repo.readPaper(imported.paper.id)?.title ?? imported.paper.title,
      importStatus,
      conversionStatus: conversion.status,
      markdownPath: conversion.markdownPath,
      passageCount: conversion.passageCount,
      message: conversion.message,
      seconds: roundSeconds(performance.now() - start)
    });
  }

  const failed = items.filter((item) => item.conversionStatus === "failed").length;
  const baseResult = {
    status: discovered.length === 0 ? "empty" as const : failed > 0 ? "partial" as const : "ok" as const,
    sourceDir: path.relative(repo.root, sourceRoot) || ".",
    discovered: discovered.length,
    imported: items.filter((item) => item.importStatus === "imported").length,
    converted: items.filter((item) => item.conversionStatus === "ok" || item.conversionStatus === "placeholder").length,
    skipped: items.filter((item) => item.conversionStatus === "skipped").length,
    failed,
    items
  };
  const summaryPath = writePdfProcessingSummary(repo, input.runId ?? null, baseResult);
  return { ...baseResult, summaryPath };
}

export function processPaperSetWithMarker(
  repo: LitAgentRepository,
  paperIds: string[],
  input: Partial<PdfProcessingOptions> & { runId?: string | null } = {},
  hooks: {
    convertPaper?: (repo: LitAgentRepository, paperId: string) => ConversionResult;
    indexPaper?: (paperId: string) => void;
    onProgress?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): PdfProcessingResult {
  const options = PdfProcessingOptionsSchema.parse(input);
  const items: PdfProcessingItem[] = [];
  for (const [index, paperId] of paperIds.entries()) {
    const paper = repo.readPaper(paperId);
    if (!paper) continue;
    const start = performance.now();
    hooks.onProgress?.(`Processing paper ${index + 1}/${paperIds.length}: ${paper.title}`, { paperId });

    if (!options.force && paper.filePaths.markdown && repo.readMarkdown(paper.id)) {
      hooks.indexPaper?.(paper.id);
      items.push({
        sourcePath: paper.filePaths.pdf ? repo.resolve(paper.filePaths.pdf) : "",
        relativePath: paper.filePaths.pdf ?? paper.id,
        paperId: paper.id,
        title: paper.title,
        importStatus: "updated",
        conversionStatus: "skipped",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paper.id).length,
        message: "Markdown already exists; skipped conversion.",
        seconds: roundSeconds(performance.now() - start)
      });
      continue;
    }

    const conversion = (hooks.convertPaper ?? convertPaperWithMarker)(repo, paper.id);
    hooks.indexPaper?.(paper.id);
    items.push({
      sourcePath: paper.filePaths.pdf ? repo.resolve(paper.filePaths.pdf) : "",
      relativePath: paper.filePaths.pdf ?? paper.id,
      paperId: paper.id,
      title: paper.title,
      importStatus: "updated",
      conversionStatus: conversion.status,
      markdownPath: conversion.markdownPath,
      passageCount: conversion.passageCount,
      message: conversion.message,
      seconds: roundSeconds(performance.now() - start)
    });
  }

  const failed = items.filter((item) => item.conversionStatus === "failed").length;
  const baseResult = {
    status: paperIds.length === 0 ? "empty" as const : failed > 0 ? "partial" as const : "ok" as const,
    sourceDir: "selected-papers",
    discovered: paperIds.length,
    imported: 0,
    converted: items.filter((item) => item.conversionStatus === "ok" || item.conversionStatus === "placeholder").length,
    skipped: items.filter((item) => item.conversionStatus === "skipped").length,
    failed,
    items
  };
  const summaryPath = writePdfProcessingSummary(repo, input.runId ?? null, baseResult);
  return { ...baseResult, summaryPath };
}

function roundSeconds(ms: number): number {
  return Math.round(ms / 10) / 100;
}

interface MarkerRuntime {
  command: string;
  argsPrefix: string[];
  source: "env" | "bundled" | "uvx";
  displayCommand: string;
}

export interface MarkerRuntimeStatus {
  available: boolean;
  source: MarkerRuntime["source"];
  command: string;
  displayCommand: string;
  message: string;
}

function markerArgs(pdfPath: string, outputDir: string): string[] {
  return [
    pdfPath,
    "--output_dir",
    outputDir,
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
}

function markerExecutableName(): string {
  return process.platform === "win32" ? "marker_single.exe" : "marker_single";
}

function bundledMarkerCandidates(converterDir: string): string[] {
  const executable = markerExecutableName();
  return [
    path.join(converterDir, "marker", executable),
    path.join(converterDir, "marker", "bin", executable),
    path.join(converterDir, "marker", "Scripts", executable),
    path.join(converterDir, executable)
  ];
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function resolveMarkerRuntime(): MarkerRuntime {
  const explicitMarker = process.env.LITAGENT_MARKER_BIN;
  if (explicitMarker) {
    return {
      command: explicitMarker,
      argsPrefix: [],
      source: "env",
      displayCommand: explicitMarker
    };
  }

  const converterDir = process.env.LITAGENT_CONVERTER_DIR;
  if (converterDir) {
    const bundledMarker = bundledMarkerCandidates(converterDir).find(fileExists);
    if (bundledMarker) {
      return {
        command: bundledMarker,
        argsPrefix: [],
        source: "bundled",
        displayCommand: bundledMarker
      };
    }
  }

  const uvx = process.env.LITAGENT_UVX_BIN ?? "uvx";
  return {
    command: uvx,
    argsPrefix: ["--from", "marker-pdf", "marker_single"],
    source: "uvx",
    displayCommand: `${uvx} --from marker-pdf marker_single`
  };
}

export function markerRuntimeStatus(): MarkerRuntimeStatus {
  const runtime = resolveMarkerRuntime();
  if (runtime.source !== "uvx") {
    const available = fileExists(runtime.command);
    return {
      available,
      source: runtime.source,
      command: runtime.command,
      displayCommand: runtime.displayCommand,
      message: available
        ? "Marker runtime is available."
        : `Configured Marker runtime does not exist: ${runtime.command}`
    };
  }

  const check = spawnSync(runtime.command, ["--version"], { encoding: "utf8" });
  const available = !check.error && check.status === 0;
  return {
    available,
    source: runtime.source,
    command: runtime.command,
    displayCommand: runtime.displayCommand,
    message: available
      ? "Using development uvx fallback for Marker."
      : "Marker runtime is not bundled and uvx is not available. Package a Marker runtime under resources/converters or set LITAGENT_MARKER_BIN."
  };
}

function tail(text: string, max = 2400): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(trimmed.length - max) : trimmed;
}

function markerFailureMessage(stdout: string, stderr: string): string {
  return `Marker failed: ${tail(stderr || stdout || "unknown error")}`;
}

function markerSpawnErrorMessage(error: unknown): string {
  const status = markerRuntimeStatus();
  const detail = error instanceof Error ? error.message : String(error);
  return `${status.message} ${detail}`.trim();
}

export function convertPaperWithMarker(repo: LitAgentRepository, paperId: string): ConversionResult {
  const paper = repo.readPaper(paperId);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);
  const pdfPath = repo.pdfPath(paperId);
  if (!pdfPath) {
    const markdown = ensureMarkdownFallback(repo, paper);
    const metrics = markdownMetrics(markdown, 0);
    return {
      status: "placeholder",
      markdownPath: repo.readPaper(paperId)?.filePaths.markdown ?? null,
      passageCount: parseMarkdownPassages(paperId, markdown).length,
      message: "No PDF is attached; wrote placeholder Markdown.",
      ...metrics
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-marker-"));
  try {
    const runtime = resolveMarkerRuntime();
    const marker = spawnSync(runtime.command, [...runtime.argsPrefix, ...markerArgs(pdfPath, tmpDir)], {
      cwd: repo.root,
      env: { ...process.env, PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF ?? "expandable_segments:True" },
      encoding: "utf8"
    });
    if (marker.error) {
      return {
        status: "failed",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paperId).length,
        message: markerSpawnErrorMessage(marker.error)
      };
    }
    if (marker.status !== 0) {
      return {
        status: "failed",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paperId).length,
        message: markerFailureMessage(marker.stdout ?? "", marker.stderr ?? "")
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
    clearMarkdownAssets(markdownDir);
    const rewritten = rewriteAssetLinks(raw, path.dirname(markdownFile), path.join(markdownDir, "assets"));
    const result = repo.writeMarkdown(paperId, rewritten.markdown);
    return {
      status: "ok",
      markdownPath: result.markdownPath,
      passageCount: result.passages.length,
      message: `Converted PDF with Marker: ${rewritten.metrics.lines ?? 0} lines, ${rewritten.metrics.imageRefs ?? 0} image refs, ${rewritten.metrics.assetsCopied ?? 0} assets.`,
      ...rewritten.metrics
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachLineProgress(
  stream: NodeJS.ReadableStream,
  streamName: "stdout" | "stderr",
  onProgress?: (message: string, payload?: Record<string, unknown>) => void
): Promise<string> {
  return new Promise((resolve) => {
    let collected = "";
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      collected += chunk;
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const message = line.trim();
        if (message) {
          onProgress?.(`Marker ${streamName}: ${message.slice(0, 500)}`, {
            stream: streamName,
            line: message
          });
        }
      }
    });
    stream.on("end", () => {
      const message = buffered.trim();
      if (message) {
        onProgress?.(`Marker ${streamName}: ${message.slice(0, 500)}`, {
          stream: streamName,
          line: message
        });
      }
      resolve(collected);
    });
  });
}

async function runMarker(
  repo: LitAgentRepository,
  pdfPath: string,
  tmpDir: string,
  onProgress?: (message: string, payload?: Record<string, unknown>) => void
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const runtime = resolveMarkerRuntime();
  const child = spawn(runtime.command, [...runtime.argsPrefix, ...markerArgs(pdfPath, tmpDir)], {
    cwd: repo.root,
    env: { ...process.env, PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF ?? "expandable_segments:True" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdout = child.stdout ? attachLineProgress(child.stdout, "stdout", onProgress) : Promise.resolve("");
  const stderr = child.stderr ? attachLineProgress(child.stderr, "stderr", onProgress) : Promise.resolve("");
  const status = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
  return {
    status,
    stdout: await stdout,
    stderr: await stderr
  };
}

export async function convertPaperWithMarkerAsync(
  repo: LitAgentRepository,
  paperId: string,
  hooks: {
    onProgress?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): Promise<ConversionResult> {
  const paper = repo.readPaper(paperId);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);
  const pdfPath = repo.pdfPath(paperId);
  if (!pdfPath) return convertPaperWithMarker(repo, paperId);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-marker-"));
  try {
    hooks.onProgress?.(`Starting Marker for ${paper.title}`, { paperId, pdfPath: paper.filePaths.pdf });
    let marker: { status: number | null; stdout: string; stderr: string };
    try {
      marker = await runMarker(repo, pdfPath, tmpDir, hooks.onProgress);
    } catch (error) {
      return {
        status: "failed",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paperId).length,
        message: markerSpawnErrorMessage(error)
      };
    }
    if (marker.status !== 0) {
      return {
        status: "failed",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paperId).length,
        message: markerFailureMessage(marker.stdout, marker.stderr)
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
    clearMarkdownAssets(markdownDir);
    const rewritten = rewriteAssetLinks(raw, path.dirname(markdownFile), path.join(markdownDir, "assets"));
    const result = repo.writeMarkdown(paperId, rewritten.markdown);
    return {
      status: "ok",
      markdownPath: result.markdownPath,
      passageCount: result.passages.length,
      message: `Converted PDF with Marker: ${rewritten.metrics.lines ?? 0} lines, ${rewritten.metrics.imageRefs ?? 0} image refs, ${rewritten.metrics.assetsCopied ?? 0} assets.`,
      ...rewritten.metrics
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function processPdfInboxAsync(
  repo: LitAgentRepository,
  input: Partial<PdfProcessingOptions> & { projectId?: string | null; runId?: string | null } = {},
  hooks: {
    convertPaper?: (repo: LitAgentRepository, paperId: string) => Promise<ConversionResult>;
    indexPaper?: (paperId: string) => void;
    onProgress?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): Promise<PdfProcessingResult> {
  const options = PdfProcessingOptionsSchema.parse(input);
  const projectId = input.projectId ?? null;
  const sourceRoot = resolvePdfSourceDir(repo, options.sourceDir);
  const discovered = discoverPdfInputs(repo, options);
  hooks.onProgress?.(`Discovered ${discovered.length} PDF(s) under ${path.relative(repo.root, sourceRoot) || "."}`, {
    sourceDir: options.sourceDir,
    discovered: discovered.length
  });

  const knownPaperIds = new Set(repo.listGlobalPapers().map((paper) => paper.id));
  const items: PdfProcessingItem[] = [];
  for (const [index, pdf] of discovered.entries()) {
    const start = performance.now();
    hooks.onProgress?.(`Processing PDF ${index + 1}/${discovered.length}: ${pdf.relativePath}`, {
      sourcePath: pdf.sourcePath,
      relativePath: pdf.relativePath,
      index: index + 1,
      total: discovered.length
    });
    const imported = repo.importPaper({
      sourcePath: pdf.sourcePath,
      projectId,
      metadata: {
        title: titleFromPdfPath(pdf.sourcePath),
        authors: []
      }
    });
    const paperBeforeConversion = repo.readPaper(imported.paper.id) ?? imported.paper;
    const importStatus = knownPaperIds.has(imported.paper.id) ? "updated" : "imported";
    knownPaperIds.add(imported.paper.id);

    let item: PdfProcessingItem;
    if (!options.force && paperBeforeConversion.filePaths.markdown && repo.readMarkdown(imported.paper.id)) {
      hooks.indexPaper?.(imported.paper.id);
      item = {
        sourcePath: pdf.sourcePath,
        relativePath: pdf.relativePath,
        paperId: imported.paper.id,
        title: imported.paper.title,
        importStatus,
        conversionStatus: "skipped",
        markdownPath: paperBeforeConversion.filePaths.markdown,
        passageCount: repo.readPassages(imported.paper.id).length,
        message: "Markdown already exists; skipped conversion.",
        seconds: roundSeconds(performance.now() - start)
      };
    } else {
      const convert = hooks.convertPaper ?? ((repository, paperId) =>
        convertPaperWithMarkerAsync(repository, paperId, hooks.onProgress ? { onProgress: hooks.onProgress } : {}));
      const conversion = await convert(repo, imported.paper.id);
      hooks.indexPaper?.(imported.paper.id);
      item = {
        sourcePath: pdf.sourcePath,
        relativePath: pdf.relativePath,
        paperId: imported.paper.id,
        title: repo.readPaper(imported.paper.id)?.title ?? imported.paper.title,
        importStatus,
        conversionStatus: conversion.status,
        markdownPath: conversion.markdownPath,
        passageCount: conversion.passageCount,
        message: conversion.message,
        seconds: roundSeconds(performance.now() - start)
      };
    }
    items.push(item);
    hooks.onProgress?.(`${item.conversionStatus === "failed" ? "Failed" : "Finished"} ${pdf.relativePath}: ${item.message}`, {
      paperId: item.paperId,
      status: item.conversionStatus,
      markdownPath: item.markdownPath,
      passageCount: item.passageCount,
      seconds: item.seconds
    });
    if (options.pauseSeconds > 0 && index < discovered.length - 1) await wait(options.pauseSeconds * 1000);
  }

  const failed = items.filter((item) => item.conversionStatus === "failed").length;
  const baseResult = {
    status: discovered.length === 0 ? "empty" as const : failed > 0 ? "partial" as const : "ok" as const,
    sourceDir: path.relative(repo.root, sourceRoot) || ".",
    discovered: discovered.length,
    imported: items.filter((item) => item.importStatus === "imported").length,
    converted: items.filter((item) => item.conversionStatus === "ok" || item.conversionStatus === "placeholder").length,
    skipped: items.filter((item) => item.conversionStatus === "skipped").length,
    failed,
    items
  };
  const summaryPath = writePdfProcessingSummary(repo, input.runId ?? null, baseResult);
  return { ...baseResult, summaryPath };
}

export async function processPaperSetWithMarkerAsync(
  repo: LitAgentRepository,
  paperIds: string[],
  input: Partial<PdfProcessingOptions> & { runId?: string | null } = {},
  hooks: {
    convertPaper?: (repo: LitAgentRepository, paperId: string) => Promise<ConversionResult>;
    indexPaper?: (paperId: string) => void;
    onProgress?: (message: string, payload?: Record<string, unknown>) => void;
  } = {}
): Promise<PdfProcessingResult> {
  const options = PdfProcessingOptionsSchema.parse(input);
  const items: PdfProcessingItem[] = [];
  for (const [index, paperId] of paperIds.entries()) {
    const paper = repo.readPaper(paperId);
    if (!paper) continue;
    const start = performance.now();
    hooks.onProgress?.(`Processing paper ${index + 1}/${paperIds.length}: ${paper.title}`, {
      paperId,
      index: index + 1,
      total: paperIds.length
    });

    let item: PdfProcessingItem;
    if (!options.force && paper.filePaths.markdown && repo.readMarkdown(paper.id)) {
      hooks.indexPaper?.(paper.id);
      item = {
        sourcePath: paper.filePaths.pdf ? repo.resolve(paper.filePaths.pdf) : "",
        relativePath: paper.filePaths.pdf ?? paper.id,
        paperId: paper.id,
        title: paper.title,
        importStatus: "updated",
        conversionStatus: "skipped",
        markdownPath: paper.filePaths.markdown,
        passageCount: repo.readPassages(paper.id).length,
        message: "Markdown already exists; skipped conversion.",
        seconds: roundSeconds(performance.now() - start)
      };
    } else {
      const convert = hooks.convertPaper ?? ((repository, id) =>
        convertPaperWithMarkerAsync(repository, id, hooks.onProgress ? { onProgress: hooks.onProgress } : {}));
      const conversion = await convert(repo, paper.id);
      hooks.indexPaper?.(paper.id);
      item = {
        sourcePath: paper.filePaths.pdf ? repo.resolve(paper.filePaths.pdf) : "",
        relativePath: paper.filePaths.pdf ?? paper.id,
        paperId: paper.id,
        title: paper.title,
        importStatus: "updated",
        conversionStatus: conversion.status,
        markdownPath: conversion.markdownPath,
        passageCount: conversion.passageCount,
        message: conversion.message,
        seconds: roundSeconds(performance.now() - start)
      };
    }
    items.push(item);
    hooks.onProgress?.(`${item.conversionStatus === "failed" ? "Failed" : "Finished"} ${paper.title}: ${item.message}`, {
      paperId: item.paperId,
      status: item.conversionStatus,
      markdownPath: item.markdownPath,
      passageCount: item.passageCount,
      seconds: item.seconds
    });
    if (options.pauseSeconds > 0 && index < paperIds.length - 1) await wait(options.pauseSeconds * 1000);
  }

  const failed = items.filter((item) => item.conversionStatus === "failed").length;
  const baseResult = {
    status: paperIds.length === 0 ? "empty" as const : failed > 0 ? "partial" as const : "ok" as const,
    sourceDir: "selected-papers",
    discovered: paperIds.length,
    imported: 0,
    converted: items.filter((item) => item.conversionStatus === "ok" || item.conversionStatus === "placeholder").length,
    skipped: items.filter((item) => item.conversionStatus === "skipped").length,
    failed,
    items
  };
  const summaryPath = writePdfProcessingSummary(repo, input.runId ?? null, baseResult);
  return { ...baseResult, summaryPath };
}

export class WorkflowEngine {
  constructor(
    private readonly repo: LitAgentRepository,
    private readonly index: SearchIndex,
    private readonly providers = new AgentProviderCatalog(),
    private readonly harness = new AgentHarness({ catalog: providers }),
    private readonly providerSettings: AgentProviderSettingsStore | null = null
  ) {}

  answerQuestion(input: QaRequestInput): QaResponse {
    const parsed = QaRequestSchema.parse(input);
    return this.buildLocalQaResponse(parsed);
  }

  async answerQuestionWithProvider(input: QaRequestInput): Promise<QaResponse> {
    const parsed = QaRequestSchema.parse(input);
    const base = this.buildLocalQaResponse(parsed);
    if (base.status !== "answered" || base.evidence.length === 0 || !this.isProviderBackedRun(parsed.providerId)) {
      return base;
    }

    const runId = createId("run");
    const eventsPath = `workflows/${runId}.jsonl`;
    const absoluteEventsPath = this.repo.resolve(eventsPath);
    const timestamp = nowIso();
    const run = WorkflowRunSchema.parse({
      id: runId,
      type: "ask-with-citations",
      projectId: parsed.projectId,
      scope: {
        paperIds: base.scope.paperIds,
        collectionIds: parsed.collectionId ? [parsed.collectionId] : [],
        query: parsed.question,
        options: { directQa: true }
      },
      providerId: parsed.providerId,
      model: parsed.model,
      status: "running",
      eventsPath,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.writeRun(run);
    for (const evidence of base.evidence) {
      appendEvent(
        absoluteEventsPath,
        event({
          runId,
          providerId: parsed.providerId,
          type: "evidence.found",
          message: evidence.quote,
          payload: evidence
        })
      );
    }

    const outputPath = this.repo.resolve(`.litagent/cache/provider-runs/${runId}/qa-answer.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    try {
      const session = this.harness.startRun({
        runId,
        providerId: parsed.providerId,
        cwd: this.repo.root,
        prompt: buildProviderQaPrompt(parsed.question, base.evidence),
        model: parsed.model,
        eventsPath: absoluteEventsPath,
        outputPath,
        artifactPaths: [outputPath]
      });
      const result = await session.finished;
      const text = providerFinalText(result);
      if (result.status === "completed" && text) {
        this.writeRun(WorkflowRunSchema.parse({ ...run, status: "completed", updatedAt: nowIso() }));
        return QaResponseSchema.parse({
          ...base,
          answer: ensureCitedProviderAnswer(text, base.evidence),
          runId,
          diagnostics: {
            ...base.diagnostics,
            message: `Generated with ${parsed.providerId}${parsed.model ? `/${parsed.model}` : ""} from ${base.evidence.length} cited passage${base.evidence.length === 1 ? "" : "s"}.`
          }
        });
      }

      const status = result.status === "cancelled" ? "cancelled" : "failed";
      this.writeRun(WorkflowRunSchema.parse({ ...run, status, updatedAt: nowIso() }));
      return QaResponseSchema.parse({
        ...base,
        runId,
        diagnostics: {
          ...base.diagnostics,
          message: `Provider ${parsed.providerId} did not return an answer${result.failureClass ? ` (${result.failureClass})` : ""}; showing extractive fallback. ${base.diagnostics.message}`
        }
      });
    } catch (error) {
      appendEvent(
        absoluteEventsPath,
        event({
          runId,
          providerId: parsed.providerId,
          type: "run.failed",
          message: error instanceof Error ? error.message : String(error),
          payload: { failureClass: "harness_error" }
        })
      );
      this.writeRun(WorkflowRunSchema.parse({ ...run, status: "failed", updatedAt: nowIso() }));
      return QaResponseSchema.parse({
        ...base,
        runId,
        diagnostics: {
          ...base.diagnostics,
          message: `Provider ${parsed.providerId} failed before answering; showing extractive fallback. ${base.diagnostics.message}`
        }
      });
    }
  }

  private buildLocalQaResponse(parsed: QaRequest): QaResponse {
    const scope = resolveQaScope(this.repo, parsed);
    const results = this.index.search(this.repo, {
      query: parsed.question,
      projectId: parsed.projectId,
      paperId: parsed.paperId,
      paperIds: parsed.paperIds,
      collectionId: parsed.collectionId,
      limit: 8
    });
    const evidence = buildEvidence(results, 5);
    const diagnostics = {
      retrievedCount: results.length,
      evidenceCount: evidence.length,
      providerId: parsed.providerId,
      model: parsed.model,
      message: evidence.length
        ? `Retrieved ${evidence.length} cited passage${evidence.length === 1 ? "" : "s"} from ${scope.paperCount} scoped paper${scope.paperCount === 1 ? "" : "s"}.`
        : scope.passageCount === 0
          ? "No indexed passages exist in the selected scope. Run PDF-to-Markdown conversion first."
          : "No retrieved passages were relevant enough for this question in the selected scope."
    };

    if (evidence.length === 0) {
      return QaResponseSchema.parse({
        answer: "Not found in the selected sources. Try broadening the scope or running Markdown conversion/indexing first.",
        evidence,
        runId: null,
        question: parsed.question,
        status: "not_found",
        scope,
        diagnostics
      });
    }

    return QaResponseSchema.parse({
      answer: buildExtractiveAnswer(parsed.question, evidence),
      evidence,
      runId: null,
      question: parsed.question,
      status: "answered",
      scope,
      diagnostics
    });
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
        query: parsed.query,
        options: parsed.options
      },
      providerId: parsed.providerId,
      model: parsed.model,
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

    if (parsed.type !== "pdf-markdown-processing" && this.isProviderBackedRun(parsed.providerId)) {
      this.startProviderBackedWorkflow(parsed, run, absoluteEventsPath);
      return run;
    }

    if (parsed.type === "pdf-markdown-processing") {
      this.startLocalBackgroundWorkflow(parsed, run, absoluteEventsPath);
      return run;
    }

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

  private startLocalBackgroundWorkflow(
    request: WorkflowStartRequest,
    run: WorkflowRun,
    absoluteEventsPath: string
  ): void {
    void this.executeWorkflowAsync(request, run.id, absoluteEventsPath)
      .then((payload) => {
        const paperIdsFromPayload = Array.isArray(payload.items)
          ? payload.items
              .map((item) => (item && typeof item === "object" && "paperId" in item ? item.paperId : null))
              .filter((paperId): paperId is string => typeof paperId === "string")
          : [];
        const completedRun = WorkflowRunSchema.parse({
          ...run,
          scope: {
            ...run.scope,
            paperIds: run.scope.paperIds.length ? run.scope.paperIds : paperIdsFromPayload
          },
          status: "completed",
          updatedAt: nowIso()
        });
        appendEvent(
          absoluteEventsPath,
          event({
            runId: run.id,
            providerId: request.providerId,
            type: "artifact.written",
            message: "Workflow artifact written",
            payload
          })
        );
        appendEvent(
          absoluteEventsPath,
          event({
            runId: run.id,
            providerId: request.providerId,
            type: "run.completed",
            message: "Workflow completed"
          })
        );
        this.writeRun(completedRun);
      })
      .catch((error: unknown) => {
        appendEvent(
          absoluteEventsPath,
          event({
            runId: run.id,
            providerId: request.providerId,
            type: "run.failed",
            message: error instanceof Error ? error.message : String(error)
          })
        );
        this.writeRun(WorkflowRunSchema.parse({ ...run, status: "failed", updatedAt: nowIso() }));
      });
  }

  cancelRun(runId: string): WorkflowRun {
    const { run } = this.readRun(runId);
    if (run.status !== "running" && run.status !== "queued") return run;
    this.harness.cancelRun(runId);
    const cancelled = WorkflowRunSchema.parse({ ...run, status: "cancelled", updatedAt: nowIso() });
    appendEvent(
      this.repo.resolve(run.eventsPath),
      event({
        runId,
        providerId: run.providerId,
        type: "run.failed",
        message: "Workflow cancellation requested",
        payload: { failureClass: "cancelled" }
      })
    );
    this.writeRun(cancelled);
    return cancelled;
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

  private isProviderBackedRun(providerId: string): boolean {
    if (this.providerSettings) this.providers.setSettings(this.providerSettings.read());
    return providerId !== "local-heuristic" && Boolean(this.providers.definition(providerId));
  }

  private startProviderBackedWorkflow(
    request: WorkflowStartRequest,
    run: WorkflowRun,
    absoluteEventsPath: string
  ): void {
    const prompt = this.buildAgentPrompt(request, run.id);
    if (this.providerSettings) this.providers.setSettings(this.providerSettings.read());
    const providerOutputPath = this.repo.resolve(`.litagent/cache/provider-runs/${run.id}/last-message.md`);
    fs.mkdirSync(path.dirname(providerOutputPath), { recursive: true });
    let session;
    try {
      session = this.harness.startRun({
        runId: run.id,
        providerId: request.providerId,
        cwd: this.repo.root,
        prompt,
        model: request.model,
        eventsPath: absoluteEventsPath,
        outputPath: providerOutputPath,
        artifactPaths: [providerOutputPath]
      });
    } catch (error) {
      appendEvent(
        absoluteEventsPath,
        event({
          runId: run.id,
          providerId: request.providerId,
          type: "run.failed",
          message: error instanceof Error ? error.message : String(error),
          payload: { failureClass: "unsupported_provider" }
        })
      );
      this.writeRun(WorkflowRunSchema.parse({ ...run, status: "failed", updatedAt: nowIso() }));
      return;
    }

    session.finished
      .then((result) => this.finishProviderBackedWorkflow(request, run, absoluteEventsPath, result))
      .catch((error: unknown) => {
        appendEvent(
          absoluteEventsPath,
          event({
            runId: run.id,
            providerId: request.providerId,
            type: "run.failed",
            message: error instanceof Error ? error.message : String(error),
            payload: { failureClass: "harness_error" }
          })
        );
        this.writeRun(WorkflowRunSchema.parse({ ...run, status: "failed", updatedAt: nowIso() }));
      });
  }

  private finishProviderBackedWorkflow(
    request: WorkflowStartRequest,
    run: WorkflowRun,
    absoluteEventsPath: string,
    result: ProviderRunResult
  ): void {
    let status: WorkflowRun["status"] = result.status === "completed" ? "completed" : "failed";
    if (result.status === "cancelled") status = "cancelled";
    if (result.status === "completed") {
      const finalText =
        result.artifacts
          .map((artifactPath) => (fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, "utf8") : ""))
          .find((content) => content.trim().length > 0) ?? result.transcript;
      const outputPath = this.writeProjectOutput(
        request.projectId,
        `${slugify(request.type)}-${slugify(run.id)}.md`,
        [
          `# ${request.type}`,
          "",
          `Provider: ${request.providerId}`,
          `Model: ${request.model ?? "CLI default"}`,
          `Run: ${run.id}`,
          "",
          finalText.trim() || "Provider completed without assistant text output."
        ].join("\n")
      );
      appendEvent(
        absoluteEventsPath,
        event({
          runId: run.id,
          providerId: request.providerId,
          type: "artifact.written",
          message: "Provider transcript artifact written",
          payload: { outputPath, sessionId: result.sessionId }
        })
      );
    }
    this.writeRun(WorkflowRunSchema.parse({ ...run, status, updatedAt: nowIso() }));
  }

  private buildAgentPrompt(request: WorkflowStartRequest, runId: string): string {
    const papers = collectPapers(this.repo, request);
    const project = request.projectId ? this.repo.readProject(request.projectId) : null;
    const researchQuestions = project?.researchQuestions.map((question) => question.text) ?? [];
    const paperContext = papers.map((paper) => this.formatPaperForPrompt(paper)).join("\n\n");
    if (request.type === "markdown-refinement") {
      return [
        "You are LitAgent, a local-first literature review assistant.",
        "Refine converted Markdown only where it is clearly malformed.",
        "Do not rewrite a whole paper. Prefer targeted patch proposals with line ranges, reasons, and before/after snippets.",
        "Preserve citations, tables, equations, figure links, and section order.",
        "",
        `Workflow run id: ${runId}`,
        `Project: ${project?.name ?? "global library"}`,
        `Provider: ${request.providerId}`,
        `Model: ${request.model ?? "CLI default"}`,
        "",
        "Selected Markdown context:",
        paperContext || "No papers are selected.",
        "",
        "Return Markdown with sections: Summary, Proposed cleanup patches, Evidence/locations, Risks."
      ].join("\n");
    }
    return [
      "You are LitAgent, a local-first agentic literature review assistant.",
      "Work only with the supplied project/library context unless the workflow explicitly asks you to find related papers.",
      "Generated metadata, tags, and claims must be proposals unless the prompt asks for a saved artifact.",
      "Every substantive claim should include evidence references using paper ids and passage ids when available.",
      "When evidence is missing, say not found in selected sources.",
      "",
      `Workflow run id: ${runId}`,
      `Workflow type: ${request.type}`,
      `Provider: ${request.providerId}`,
      `Model: ${request.model ?? "CLI default"}`,
      `Project: ${project?.name ?? "global library"}`,
      `Question/query: ${request.query ?? researchQuestions[0] ?? "none supplied"}`,
      `Options: ${JSON.stringify(request.options)}`,
      "",
      "Research questions:",
      ...(researchQuestions.length ? researchQuestions.map((question) => `- ${question}`) : ["- none supplied"]),
      "",
      "Selected paper context:",
      paperContext || "No papers are selected.",
      "",
      "Write a concise Markdown result. Include a short Evidence section with paper ids, pages, and passage ids where possible."
    ].join("\n");
  }

  private formatPaperForPrompt(paper: Paper): string {
    const passages = this.repo.readPassages(paper.id).slice(0, 5);
    const markdown = this.repo.readMarkdown(paper.id);
    const markdownExcerpt = markdown ? markdown.split("\n").slice(0, 80).join("\n") : "";
    return [
      `## ${paper.title}`,
      `paperId: ${paper.id}`,
      `authors: ${paper.authors.join(", ") || "unknown"}`,
      `year: ${paper.year ?? "unknown"}`,
      `doi: ${paper.doi ?? "none"}`,
      `arxivId: ${paper.arxivId ?? "none"}`,
      `tags: ${paper.tags.join(", ") || "none"}`,
      `markdownPath: ${paper.filePaths.markdown ?? "none"}`,
      "passages:",
      ...(
        passages.length
          ? passages.map((passage) => `- ${passage.id} p.${passage.page ?? "?"} ${passage.section}: ${passage.quote}`)
          : ["- no indexed passages"]
      ),
      markdownExcerpt ? "\nmarkdown excerpt:\n```markdown\n" + markdownExcerpt + "\n```" : ""
    ].join("\n");
  }

  private executeWorkflow(
    request: WorkflowStartRequest,
    runId: string,
    absoluteEventsPath: string
  ): Record<string, unknown> {
    const papers = collectPapers(this.repo, request);
    switch (request.type) {
      case "pdf-markdown-processing": {
        const options = PdfProcessingOptionsSchema.parse(request.options);
        const commonHooks = {
          convertPaper: convertPaperWithMarker,
          indexPaper: (paperId: string) => {
            const paper = this.repo.readPaper(paperId);
            if (paper) this.index.indexPaper(paper, this.repo.readPassages(paperId));
          },
          onProgress: (message: string, payload?: Record<string, unknown>) =>
            appendEvent(
              absoluteEventsPath,
              event({
                runId,
                providerId: request.providerId,
                type: "tool.result",
                message,
                ...(payload ? { payload } : {})
              })
            )
        };
        const result = request.paperIds.length > 0
          ? processPaperSetWithMarker(
              this.repo,
              request.paperIds,
              {
                ...options,
                runId
              },
              commonHooks
            )
          : processPdfInbox(
              this.repo,
              {
                ...options,
                projectId: request.projectId,
                runId
              },
              commonHooks
            );
        return { ...result };
      }
      case "markdown-refinement": {
        const lines = [
          "# Markdown Refinement",
          "",
          "Select a connected CLI provider/model to run agentic Markdown cleanup. This artifact records the papers that are ready for refinement.",
          "",
          ...papers.map((paper) => {
            const markdown = this.repo.readMarkdown(paper.id);
            return `- ${paper.title}: ${markdown ? "Markdown available" : "Markdown missing"}`;
          })
        ];
        const outputPath = this.writeProjectOutput(request.projectId, `markdown-refinement-${slugify(runId)}.md`, lines.join("\n"));
        return { outputPath, paperCount: papers.length };
      }
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
          paperIds: request.paperIds,
          collectionId: request.collectionIds[0] ?? null,
          providerId: request.providerId,
          model: request.model
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

  private async executeWorkflowAsync(
    request: WorkflowStartRequest,
    runId: string,
    absoluteEventsPath: string
  ): Promise<Record<string, unknown>> {
    if (request.type !== "pdf-markdown-processing") return this.executeWorkflow(request, runId, absoluteEventsPath);

    const options = PdfProcessingOptionsSchema.parse(request.options);
    const commonHooks = {
      indexPaper: (paperId: string) => {
        const paper = this.repo.readPaper(paperId);
        if (paper) this.index.indexPaper(paper, this.repo.readPassages(paperId));
      },
      onProgress: (message: string, payload?: Record<string, unknown>) =>
        appendEvent(
          absoluteEventsPath,
          event({
            runId,
            providerId: request.providerId,
            type: "tool.result",
            message,
            ...(payload ? { payload } : {})
          })
        )
    };

    const result = request.paperIds.length > 0
      ? await processPaperSetWithMarkerAsync(
          this.repo,
          request.paperIds,
          {
            ...options,
            runId
          },
          commonHooks
        )
      : await processPdfInboxAsync(
          this.repo,
          {
            ...options,
            projectId: request.projectId,
            runId
          },
          commonHooks
        );
    return { ...result };
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
