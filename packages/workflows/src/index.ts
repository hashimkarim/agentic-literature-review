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
  MetadataFieldNameSchema,
  MetadataFieldValueSchema,
  NormalizedRunEventSchema,
  QaRequestSchema,
  QaResponseSchema,
  QaScopeSchema,
  QaThreadRequestSchema,
  QaThreadSchema,
  ResearchAttributeValueSchema,
  ResearchRecordKindSchema,
  WorkflowRunSchema,
  WorkflowTypeSchema,
  type EvidenceRef,
  type MetadataFieldName,
  type MetadataFieldProposal,
  type NormalizedRunEvent,
  type Paper,
  type Passage,
  type QaRequest,
  type QaRequestInput,
  type QaResponse,
  type QaScope,
  type QaThread,
  type QaThreadRequestInput,
  type ResearchItem,
  type ResearchRecordKind,
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

const ProviderRelevanceProposalSchema = z.object({
  paperId: z.string(),
  proposedState: z.enum(["included", "excluded", "maybe", "not_found"]),
  relevanceScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  projectTags: z.array(z.string()).default([]),
  evidencePassageIds: z.array(z.string()).default([])
});

const ProviderRelevanceResultSchema = z.object({
  proposals: z.array(ProviderRelevanceProposalSchema).min(1)
});

const ProviderMetadataFieldSchema = z.object({
  field: MetadataFieldNameSchema,
  proposedValue: MetadataFieldValueSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidencePassageIds: z.array(z.string()).default([])
});

const ProviderMetadataResultSchema = z.object({
  proposals: z.array(z.object({
    paperId: z.string(),
    fields: z.array(ProviderMetadataFieldSchema).default([])
  })).min(1)
});

const ProviderResearchItemSchema = z.object({
  kind: ResearchRecordKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  attributes: z.record(z.string(), ResearchAttributeValueSchema).default({}),
  confidence: z.number().min(0).max(1),
  evidencePassageIds: z.array(z.string()).min(1)
});

const ProviderResearchFindingsResultSchema = z.object({
  proposals: z.array(z.object({
    paperId: z.string(),
    items: z.array(ProviderResearchItemSchema).default([])
  })).min(1)
});

function parseProviderJson(text: string): unknown {
  const candidates = [
    ...[...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]?.trim() ?? ""),
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1).trim(),
    text.trim()
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Provider output can include commentary around the structured result.
    }
  }
  throw new Error("Provider did not return a valid structured JSON result.");
}

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

function scoreRelevance(paper: Paper, query: string, markdown = ""): number {
  const metadata = `${paper.title} ${paper.authors.join(" ")} ${paper.tags.join(" ")}`.toLowerCase();
  const content = markdown.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3);
  if (terms.length === 0) return 0.5;
  const metadataHits = terms.filter((term) => metadata.includes(term)).length;
  const contentHits = terms.filter((term) => content.includes(term)).length;
  return Math.min(1, (metadataHits * 2 + contentHits) / (terms.length * 3));
}

function proposedRelevanceState(score: number): "included" | "excluded" | "maybe" {
  if (score >= 0.45) return "included";
  if (score >= 0.15) return "maybe";
  return "excluded";
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

const markdownContextCharBudget = 180_000;
const answerEvidenceStopwords = new Set([
  "about",
  "after",
  "also",
  "because",
  "between",
  "could",
  "from",
  "have",
  "into",
  "more",
  "only",
  "paper",
  "papers",
  "question",
  "should",
  "source",
  "sources",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would"
]);

interface QaMarkdownPaperContext {
  paper: Paper;
  markdown: string;
  passages: ReturnType<LitAgentRepository["readPassages"]>;
  truncated: boolean;
}

interface QaMarkdownContext {
  papers: QaMarkdownPaperContext[];
  promptContext: string;
  contextChars: number;
  passageCount: number;
  truncated: boolean;
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

function qaConversationContext(thread: QaThread): string {
  const maxMessages = 8;
  const maxChars = 12_000;
  const messages = thread.messages.slice(-maxMessages);
  const lines: string[] = [];
  let usedChars = 0;
  for (const message of messages.reverse()) {
    const label = message.role === "user" ? "User" : "Assistant";
    const line = `${label}: ${message.content.trim()}`;
    if (usedChars + line.length > maxChars && lines.length > 0) break;
    lines.unshift(line.slice(0, Math.max(0, maxChars - usedChars)));
    usedChars += line.length;
  }
  return lines.join("\n\n");
}

function buildProviderQaPrompt(question: string, context: QaMarkdownContext, thread: QaThread): string {
  const conversation = qaConversationContext(thread);
  return [
    "You are LitAgent answering a literature-review question from converted Markdown papers.",
    "Use only the Markdown context below. Do not inspect files, run tools, or write files.",
    "Use the prior conversation only to understand follow-up wording. It is not a factual source and must not be cited.",
    "If the Markdown context does not answer the question, say: Not found in the selected sources.",
    "Answer from the whole paper context, not from a preselected evidence snippet list.",
    "Keep the answer concise and avoid adding outside knowledge.",
    "After you answer, LitAgent will attach supporting evidence by linking your claims back to source passages.",
    "",
    conversation ? `Prior conversation:\n${conversation}` : "Prior conversation: none",
    "",
    `Question: ${question}`,
    "",
    "Markdown context:",
    context.promptContext
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

function buildQaMarkdownContext(repo: LitAgentRepository, scope: QaScope): QaMarkdownContext {
  const paperIds = scope.paperIds;
  const maxPerPaper = scope.type === "paper"
    ? markdownContextCharBudget
    : Math.max(12_000, Math.floor(markdownContextCharBudget / Math.max(1, paperIds.length)));
  const papers: QaMarkdownPaperContext[] = [];
  let remaining = markdownContextCharBudget;
  let truncated = false;
  for (const paperId of paperIds) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const paper = repo.readPaper(paperId);
    const markdown = repo.readMarkdown(paperId);
    if (!paper || !markdown) continue;
    const allowed = Math.min(maxPerPaper, remaining);
    const included = markdown.length > allowed ? markdown.slice(0, allowed) : markdown;
    const paperTruncated = included.length < markdown.length;
    papers.push({
      paper,
      markdown: included,
      passages: repo.readPassages(paperId),
      truncated: paperTruncated
    });
    remaining -= included.length;
    if (paperTruncated) truncated = true;
  }
  const promptContext = papers
    .map((item, index) =>
      [
        `--- PAPER ${index + 1}: ${item.paper.title} ---`,
        `paperId: ${item.paper.id}`,
        item.paper.authors.length ? `authors: ${item.paper.authors.join(", ")}` : "authors: unknown",
        item.paper.year ? `year: ${item.paper.year}` : "year: unknown",
        item.truncated ? "note: Markdown was truncated to fit the current model context budget." : "note: Full available Markdown included.",
        "",
        item.markdown
      ].join("\n")
    )
    .join("\n\n");
  return {
    papers,
    promptContext,
    contextChars: promptContext.length,
    passageCount: papers.reduce((count, item) => count + item.passages.length, 0),
    truncated
  };
}

function supportTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 3 && !answerEvidenceStopwords.has(term))
    )
  ];
}

function buildEvidenceFromAnswer(question: string, answer: string, context: QaMarkdownContext, limit: number): EvidenceRef[] {
  if (/not found in the selected sources/i.test(answer)) return [];
  const answerTerms = supportTerms(answer);
  const questionTerms = supportTerms(question);
  if (answerTerms.length === 0) return [];
  return context.papers
    .flatMap((item) =>
      item.passages.map((passage) => {
        const quote = passage.quote.toLowerCase();
        const answerHits = answerTerms.filter((term) => quote.includes(term)).length;
        const questionHits = questionTerms.filter((term) => quote.includes(term)).length;
        const score = answerHits * 2 + questionHits;
        return { item, passage, score };
      })
    )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate, index) =>
      EvidenceRefSchema.parse({
        paperId: candidate.item.paper.id,
        passageId: candidate.passage.id,
        page: candidate.passage.page,
        paperTitle: candidate.item.paper.title,
        section: candidate.passage.section,
        quote: candidate.passage.quote,
        confidence: Math.max(0.45, 0.88 - index * 0.08)
      })
    );
}

function qaThreadScope(input: QaThreadRequestInput) {
  const parsed = QaThreadRequestSchema.parse(input);
  return {
    projectId: parsed.projectId,
    paperId: parsed.paperId,
    paperIds: [...new Set(parsed.paperIds)].sort(),
    collectionId: parsed.collectionId
  };
}

function qaThreadId(input: QaThreadRequestInput): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify(qaThreadScope(input))).digest("hex").slice(0, 18);
  return `qa_${hash}`;
}

function paperMetadataValue(paper: Paper, field: MetadataFieldName) {
  return paper[field];
}

function metadataValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferMetadataFields(paper: Paper, markdown: string): Array<{
  field: MetadataFieldName;
  proposedValue: string | number | string[] | null;
  confidence: number;
  rationale: string;
}> {
  const frontMatter = markdown.slice(0, 6000);
  const fields: ReturnType<typeof inferMetadataFields> = [];
  const heading = frontMatter.match(/^#\s+(.+)$/m)?.[1]?.replace(/<[^>]+>/g, "").trim();
  if (heading && heading.length > 4 && !metadataValuesEqual(heading, paper.title)) {
    fields.push({
      field: "title",
      proposedValue: heading,
      confidence: 0.72,
      rationale: "The first level-one Markdown heading differs from the canonical title."
    });
  }
  const doi = frontMatter.match(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i)?.[0]?.replace(/[.,;)]+$/g, "") ?? null;
  if (doi && doi.toLowerCase() !== paper.doi?.toLowerCase()) {
    fields.push({ field: "doi", proposedValue: doi, confidence: 0.86, rationale: "A DOI-shaped identifier appears in the document front matter." });
  }
  const arxivId = frontMatter.match(/(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/i)?.[1] ?? null;
  if (arxivId && arxivId !== paper.arxivId) {
    fields.push({ field: "arxivId", proposedValue: arxivId, confidence: 0.82, rationale: "An arXiv identifier appears in the document front matter." });
  }
  const year = Number(frontMatter.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0) || null;
  if (year && year !== paper.year) {
    fields.push({ field: "year", proposedValue: year, confidence: 0.58, rationale: "A likely publication year appears in the document front matter." });
  }
  return fields;
}

function localResearchKind(passage: Passage): ResearchRecordKind {
  const section = passage.section.toLowerCase();
  if (/limitation|threat|weakness|future work/.test(section)) return "limitation";
  if (/result|evaluation|finding|conclusion/.test(section)) return "result";
  if (/method|methodology|approach|architecture|algorithm/.test(section)) return "method";
  if (/dataset|data|corpus|benchmark/.test(section)) return "dataset";
  if (/reproduc|implementation|code/.test(section)) return "reproducibility";
  const text = `${passage.section} ${passage.quote}`.toLowerCase();
  if (/limitation|threat|weakness|future work|challenge/.test(text)) return "limitation";
  if (/reproduc|code|implementation|hyperparameter|open source/.test(text)) return "reproducibility";
  if (/dataset|corpus|benchmark|participants|sample/.test(text)) return "dataset";
  if (/result|evaluation|accuracy|performance|improv|outperform|significant/.test(text)) return "result";
  if (/method|methodology|model|architecture|algorithm|approach|procedure/.test(text)) return "method";
  return "finding";
}

function localResearchTitle(kind: ResearchRecordKind, passage: Passage): string {
  const section = passage.section.trim();
  if (section) return `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)} from ${section}`;
  const sentence = passage.quote.split(/(?<=[.!?])\s+/)[0]?.trim() ?? passage.quote.trim();
  return sentence.length > 88 ? `${sentence.slice(0, 85).trim()}...` : sentence;
}

function inferLocalResearchItems(repo: LitAgentRepository, paper: Paper): ResearchItem[] {
  const counts = new Map<ResearchRecordKind, number>();
  const items: ResearchItem[] = [];
  for (const passage of repo.readPassages(paper.id)) {
    const kind = localResearchKind(passage);
    const count = counts.get(kind) ?? 0;
    if (count >= 2 || passage.quote.trim().length < 30) continue;
    counts.set(kind, count + 1);
    items.push({
      id: createId("item"),
      kind,
      title: localResearchTitle(kind, passage),
      content: passage.quote.trim().slice(0, 1200),
      attributes: passage.section ? { section: passage.section } : {},
      confidence: 0.56,
      evidence: [{
        paperId: paper.id,
        passageId: passage.id,
        page: passage.page,
        paperTitle: paper.title,
        section: passage.section,
        quote: passage.quote,
        confidence: 0.7
      }]
    });
    if (items.length >= 10) break;
  }
  return items;
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

  readQaThread(input: QaThreadRequestInput): QaThread {
    const parsed = qaThreadScope(input);
    const id = qaThreadId(parsed);
    const filePath = this.qaThreadPath(id);
    if (fs.existsSync(filePath)) {
      return QaThreadSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    }
    const timestamp = nowIso();
    return QaThreadSchema.parse({
      id,
      title: this.qaThreadTitle(parsed),
      projectId: parsed.projectId,
      paperId: parsed.paperId,
      paperIds: parsed.paperIds,
      collectionId: parsed.collectionId,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  clearQaThread(input: QaThreadRequestInput): QaThread {
    const parsed = qaThreadScope(input);
    const id = qaThreadId(parsed);
    const filePath = this.qaThreadPath(id);
    if (fs.existsSync(filePath)) {
      const archiveDir = this.repo.resolve(".litagent/chat-threads/archive");
      const archiveTimestamp = nowIso().replace(/[:.]/g, "-");
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.copyFileSync(filePath, path.join(archiveDir, `${id}-${archiveTimestamp}.json`));
      fs.rmSync(filePath);
    }
    return this.readQaThread(parsed);
  }

  recordQaExchange(input: QaThreadRequestInput, response: QaResponse): { thread: QaThread; response: QaResponse } {
    const thread = this.readQaThread(input);
    const timestamp = nowIso();
    const userMessageId = createId("qmsg");
    const assistantMessageId = createId("qmsg");
    const responseWithThread = QaResponseSchema.parse({
      ...response,
      threadId: thread.id,
      messageId: assistantMessageId
    });
    const updated = QaThreadSchema.parse({
      ...thread,
      messages: [
        ...thread.messages,
        {
          id: userMessageId,
          role: "user",
          content: response.question,
          createdAt: timestamp,
          response: null
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: responseWithThread.answer,
          createdAt: timestamp,
          response: responseWithThread
        }
      ],
      updatedAt: timestamp
    });
    fs.mkdirSync(path.dirname(this.qaThreadPath(thread.id)), { recursive: true });
    fs.writeFileSync(this.qaThreadPath(thread.id), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    return { thread: updated, response: responseWithThread };
  }

  async answerQuestionWithProvider(input: QaRequestInput): Promise<QaResponse> {
    const parsed = QaRequestSchema.parse(input);
    const scope = resolveQaScope(this.repo, parsed);
    const context = buildQaMarkdownContext(this.repo, scope);
    const thread = this.readQaThread(parsed);
    if (!this.isProviderBackedRun(parsed.providerId)) {
      return this.buildLocalQaResponse(parsed);
    }
    const baseDiagnostics = {
      retrievedCount: context.passageCount,
      evidenceCount: 0,
      providerId: parsed.providerId,
      model: parsed.model,
      contextMode: "markdown-context" as const,
      contextChars: context.contextChars,
      message: context.papers.length
        ? `Using Markdown context from ${context.papers.length} paper${context.papers.length === 1 ? "" : "s"}${context.truncated ? " (truncated to fit context budget)" : ""}.`
        : "No converted Markdown exists in the selected scope. Run PDF-to-Markdown conversion first."
    };
    if (context.papers.length === 0) {
      return QaResponseSchema.parse({
        answer: "Not found in the selected sources. Run PDF-to-Markdown conversion first so LitAgent can use the Markdown context.",
        evidence: [],
        runId: null,
        question: parsed.question,
        status: "not_found",
        scope,
        diagnostics: baseDiagnostics
      });
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
        paperIds: scope.paperIds,
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

    const outputPath = this.repo.resolve(`.litagent/cache/provider-runs/${runId}/qa-answer.md`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    try {
      const session = this.harness.startRun({
        runId,
        providerId: parsed.providerId,
        cwd: this.repo.root,
        prompt: buildProviderQaPrompt(parsed.question, context, thread),
        model: parsed.model,
        eventsPath: absoluteEventsPath,
        outputPath,
        artifactPaths: [outputPath]
      });
      const result = await session.finished;
      const text = providerFinalText(result);
      if (result.status === "completed" && text) {
        const evidence = buildEvidenceFromAnswer(parsed.question, text, context, 5);
        for (const item of evidence) {
          appendEvent(
            absoluteEventsPath,
            event({
              runId,
              providerId: parsed.providerId,
              type: "evidence.found",
              message: item.quote,
              payload: item
            })
          );
        }
        const status = /not found in the selected sources/i.test(text) || evidence.length === 0 ? "not_found" : "answered";
        this.writeRun(WorkflowRunSchema.parse({ ...run, status: "completed", updatedAt: nowIso() }));
        return QaResponseSchema.parse({
          answer: status === "not_found" ? "Not found in the selected sources." : ensureCitedProviderAnswer(text, evidence),
          evidence,
          runId,
          question: parsed.question,
          status,
          scope,
          diagnostics: {
            ...baseDiagnostics,
            evidenceCount: evidence.length,
            message: status === "not_found"
              ? `Generated with ${parsed.providerId}, but no supporting passage could be linked from the Markdown context.`
              : `Generated with ${parsed.providerId}${parsed.model ? `/${parsed.model}` : ""} from Markdown context; attached ${evidence.length} supporting passage${evidence.length === 1 ? "" : "s"}.`
          }
        });
      }

      const status = result.status === "cancelled" ? "cancelled" : "failed";
      this.writeRun(WorkflowRunSchema.parse({ ...run, status, updatedAt: nowIso() }));
      const fallback = this.buildLocalQaResponse(parsed);
      return QaResponseSchema.parse({
        ...fallback,
        runId,
        diagnostics: {
          ...fallback.diagnostics,
          message: `Provider ${parsed.providerId} did not return an answer${result.failureClass ? ` (${result.failureClass})` : ""}; showing extractive fallback. ${fallback.diagnostics.message}`
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
      const fallback = this.buildLocalQaResponse(parsed);
      return QaResponseSchema.parse({
        ...fallback,
        runId,
        diagnostics: {
          ...fallback.diagnostics,
          message: `Provider ${parsed.providerId} failed before answering; showing extractive fallback. ${fallback.diagnostics.message}`
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

  private qaThreadPath(threadId: string): string {
    return this.repo.resolve(`.litagent/chat-threads/${threadId}.json`);
  }

  private qaThreadTitle(input: ReturnType<typeof qaThreadScope>): string {
    if (input.paperId) return this.repo.readPaper(input.paperId)?.title ?? "Paper Q&A";
    if (input.collectionId && input.projectId) return this.repo.readCollection(input.projectId, input.collectionId)?.name ?? "Collection Q&A";
    if (input.projectId) return this.repo.readProject(input.projectId)?.name ?? "Project Q&A";
    if (input.paperIds.length > 0) return `Selection Q&A (${input.paperIds.length} papers)`;
    return "Global library Q&A";
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
      let proposalIds: string[] = [];
      if (request.type === "relevance-tagging") {
        try {
          proposalIds = this.createProviderRelevanceProposals(request, run.id, finalText, absoluteEventsPath);
        } catch (error) {
          status = "failed";
          appendEvent(
            absoluteEventsPath,
            event({
              runId: run.id,
              providerId: request.providerId,
              type: "run.failed",
              message: error instanceof Error ? error.message : String(error),
              payload: { failureClass: "invalid_workflow_output" }
            })
          );
        }
      } else if (request.type === "metadata-extraction") {
        try {
          proposalIds = this.createProviderMetadataProposals(request, run.id, finalText, absoluteEventsPath);
        } catch (error) {
          status = "failed";
          appendEvent(
            absoluteEventsPath,
            event({
              runId: run.id,
              providerId: request.providerId,
              type: "run.failed",
              message: error instanceof Error ? error.message : String(error),
              payload: { failureClass: "invalid_workflow_output" }
            })
          );
        }
      } else if (request.type === "key-findings") {
        try {
          proposalIds = this.createProviderResearchFindingProposals(request, run.id, finalText, absoluteEventsPath);
        } catch (error) {
          status = "failed";
          appendEvent(
            absoluteEventsPath,
            event({
              runId: run.id,
              providerId: request.providerId,
              type: "run.failed",
              message: error instanceof Error ? error.message : String(error),
              payload: { failureClass: "invalid_workflow_output" }
            })
          );
        }
      }
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
          payload: { outputPath, sessionId: result.sessionId, proposalIds }
        })
      );
    }
    this.writeRun(WorkflowRunSchema.parse({ ...run, status, updatedAt: nowIso() }));
  }

  private createProviderRelevanceProposals(
    request: WorkflowStartRequest,
    runId: string,
    providerText: string,
    absoluteEventsPath: string
  ): string[] {
    if (!request.projectId) throw new Error("Relevance tagging requires a project scope.");
    const projectId = request.projectId;
    const project = this.repo.readProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const researchQuestion = request.query
      ? project.researchQuestions.find((candidate) => candidate.text === request.query) ?? null
      : project.researchQuestions[0] ?? null;
    const question = request.query ?? researchQuestion?.text ?? "";
    if (!question.trim()) throw new Error("Relevance tagging requires a research question or query.");

    const papers = collectPapers(this.repo, request);
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    const parsed = ProviderRelevanceResultSchema.parse(parseProviderJson(providerText));
    const proposalByPaper = new Map(parsed.proposals.map((proposal) => [proposal.paperId, proposal]));
    const missingPaperIds = papers.filter((paper) => !proposalByPaper.has(paper.id)).map((paper) => paper.id);
    if (missingPaperIds.length > 0) {
      throw new Error(`Provider omitted relevance proposals for: ${missingPaperIds.join(", ")}`);
    }
    for (const proposal of parsed.proposals) {
      if (!paperById.has(proposal.paperId)) {
        throw new Error(`Provider returned an out-of-scope paper id: ${proposal.paperId}`);
      }
    }

    return parsed.proposals.map((candidate) => {
      const paper = paperById.get(candidate.paperId);
      if (!paper) throw new Error(`Paper not found in workflow scope: ${candidate.paperId}`);
      const passageById = new Map(this.repo.readPassages(paper.id).map((passage) => [passage.id, passage]));
      let evidence = candidate.evidencePassageIds.flatMap((passageId) => {
        const passage = passageById.get(passageId);
        return passage ? [{
          paperId: paper.id,
          passageId: passage.id,
          page: passage.page,
          paperTitle: paper.title,
          section: passage.section,
          quote: passage.quote,
          confidence: candidate.confidence
        }] : [];
      });
      if (evidence.length === 0) {
        evidence = buildEvidence(
          this.index.search(this.repo, {
            query: `${question} ${candidate.rationale}`,
            projectId,
            paperId: paper.id,
            limit: 3
          }),
          3
        );
      }
      const proposal = this.repo.createRelevanceProposal({
        runId,
        projectId,
        paperId: paper.id,
        researchQuestionId: researchQuestion?.id ?? null,
        question,
        proposedState: evidence.length === 0 && candidate.proposedState !== "not_found" ? "not_found" : candidate.proposedState,
        relevanceScore: candidate.relevanceScore,
        confidence: evidence.length ? candidate.confidence : Math.min(candidate.confidence, 0.25),
        rationale: evidence.length ? candidate.rationale : "The provider did not identify a valid supporting passage in the selected sources.",
        projectTags: candidate.projectTags,
        evidence,
        providerId: request.providerId,
        model: request.model
      });
      for (const item of proposal.evidence) {
        appendEvent(
          absoluteEventsPath,
          event({
            runId,
            providerId: request.providerId,
            type: "evidence.found",
            message: item.quote,
            payload: item
          })
        );
      }
      return proposal.id;
    });
  }

  private createProviderMetadataProposals(
    request: WorkflowStartRequest,
    runId: string,
    providerText: string,
    absoluteEventsPath: string
  ): string[] {
    const papers = collectPapers(this.repo, request);
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    const parsed = ProviderMetadataResultSchema.parse(parseProviderJson(providerText));
    const proposalByPaper = new Map(parsed.proposals.map((proposal) => [proposal.paperId, proposal]));
    const missingPaperIds = papers.filter((paper) => !proposalByPaper.has(paper.id)).map((paper) => paper.id);
    if (missingPaperIds.length > 0) {
      throw new Error(`Provider omitted metadata proposals for: ${missingPaperIds.join(", ")}`);
    }
    for (const proposal of parsed.proposals) {
      if (!paperById.has(proposal.paperId)) {
        throw new Error(`Provider returned an out-of-scope paper id: ${proposal.paperId}`);
      }
    }

    return parsed.proposals.flatMap((candidate) => {
      const paper = paperById.get(candidate.paperId);
      if (!paper) throw new Error(`Paper not found in workflow scope: ${candidate.paperId}`);
      const passageById = new Map(this.repo.readPassages(paper.id).map((passage) => [passage.id, passage]));
      const fields: MetadataFieldProposal[] = candidate.fields
        .filter((field) => !metadataValuesEqual(paperMetadataValue(paper, field.field), field.proposedValue))
        .map((field) => {
          let evidence = field.evidencePassageIds.flatMap((passageId) => {
            const passage = passageById.get(passageId);
            return passage ? [{
              paperId: paper.id,
              passageId: passage.id,
              page: passage.page,
              paperTitle: paper.title,
              section: passage.section,
              quote: passage.quote,
              confidence: field.confidence
            }] : [];
          });
          if (evidence.length === 0) {
            evidence = buildEvidence(
              this.index.search(this.repo, {
                query: `${field.field} ${Array.isArray(field.proposedValue) ? field.proposedValue.join(" ") : String(field.proposedValue ?? "")}`,
                projectId: request.projectId,
                paperId: paper.id,
                limit: 2
              }),
              2
            );
          }
          return {
            field: field.field,
            currentValue: paperMetadataValue(paper, field.field),
            proposedValue: field.proposedValue,
            confidence: evidence.length ? field.confidence : Math.min(field.confidence, 0.35),
            rationale: evidence.length ? field.rationale : `${field.rationale} No exact supporting passage was linked.`,
            evidence
          };
        });
      if (fields.length === 0) return [];
      const proposal = this.repo.createMetadataProposal({
        runId,
        projectId: request.projectId,
        paperId: paper.id,
        fields,
        providerId: request.providerId,
        model: request.model
      });
      for (const field of proposal.fields) {
        for (const item of field.evidence) {
          appendEvent(
            absoluteEventsPath,
            event({
              runId,
              providerId: request.providerId,
              type: "evidence.found",
              message: `${field.field}: ${item.quote}`,
              payload: { ...item, metadataField: field.field }
            })
          );
        }
      }
      return [proposal.id];
    });
  }

  private createProviderResearchFindingProposals(
    request: WorkflowStartRequest,
    runId: string,
    providerText: string,
    absoluteEventsPath: string
  ): string[] {
    const papers = collectPapers(this.repo, request);
    const paperById = new Map(papers.map((paper) => [paper.id, paper]));
    const parsed = ProviderResearchFindingsResultSchema.parse(parseProviderJson(providerText));
    const proposalByPaper = new Map(parsed.proposals.map((proposal) => [proposal.paperId, proposal]));
    const missingPaperIds = papers.filter((paper) => !proposalByPaper.has(paper.id)).map((paper) => paper.id);
    if (missingPaperIds.length > 0) {
      throw new Error(`Provider omitted research findings for: ${missingPaperIds.join(", ")}`);
    }
    for (const proposal of parsed.proposals) {
      if (!paperById.has(proposal.paperId)) {
        throw new Error(`Provider returned an out-of-scope paper id: ${proposal.paperId}`);
      }
    }

    return parsed.proposals.flatMap((candidate) => {
      const paper = paperById.get(candidate.paperId);
      if (!paper) throw new Error(`Paper not found in workflow scope: ${candidate.paperId}`);
      const passageById = new Map(this.repo.readPassages(paper.id).map((passage) => [passage.id, passage]));
      const items: ResearchItem[] = candidate.items.map((item) => {
        const evidence = item.evidencePassageIds.flatMap((passageId) => {
          const passage = passageById.get(passageId);
          return passage ? [{
            paperId: paper.id,
            passageId: passage.id,
            page: passage.page,
            paperTitle: paper.title,
            section: passage.section,
            quote: passage.quote,
            confidence: item.confidence
          }] : [];
        });
        if (evidence.length === 0) {
          throw new Error(`Provider research item has no valid evidence passage: ${item.title}`);
        }
        return {
          id: createId("item"),
          kind: item.kind,
          title: item.title,
          content: item.content,
          attributes: item.attributes,
          confidence: item.confidence,
          evidence
        };
      });
      if (items.length === 0) return [];
      const proposal = this.repo.createResearchFindingProposal({
        runId,
        projectId: request.projectId,
        paperId: paper.id,
        items,
        providerId: request.providerId,
        model: request.model
      });
      for (const item of proposal.items) {
        for (const evidence of item.evidence) {
          appendEvent(
            absoluteEventsPath,
            event({
              runId,
              providerId: request.providerId,
              type: "evidence.found",
              message: `${item.kind}: ${evidence.quote}`,
              payload: { ...evidence, researchItemId: item.id, researchKind: item.kind }
            })
          );
        }
      }
      return [proposal.id];
    });
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
    if (request.type === "relevance-tagging") {
      return [
        "You are LitAgent screening research papers against a research question.",
        "Use only the supplied paper metadata, passages, and Markdown excerpts.",
        "Return one proposal for every selected paper. Do not modify files.",
        "A substantive relevance rationale must cite one or more supplied passage ids when passages exist.",
        "Use not_found when the supplied content is insufficient to make a relevance judgment.",
        "Return only JSON with no Markdown fence or commentary.",
        "Schema: {\"proposals\":[{\"paperId\":\"...\",\"proposedState\":\"included|excluded|maybe|not_found\",\"relevanceScore\":0.0,\"confidence\":0.0,\"rationale\":\"...\",\"projectTags\":[\"...\"],\"evidencePassageIds\":[\"...\"]}]}",
        "relevanceScore measures topical relevance from 0 to 1. confidence measures confidence in the classification from 0 to 1.",
        "Project tags must be short factual topic tags, not workflow status labels.",
        "",
        `Workflow run id: ${runId}`,
        `Project: ${project?.name ?? "global library"}`,
        `Research question: ${request.query ?? researchQuestions[0] ?? "none supplied"}`,
        "",
        "Selected paper context:",
        paperContext || "No papers are selected."
      ].join("\n");
    }
    if (request.type === "metadata-extraction") {
      return [
        "You are LitAgent extracting canonical bibliographic metadata from research papers.",
        "Use only the supplied paper metadata, passages, and Markdown excerpts.",
        "Return only fields that should change. Do not invent missing values and do not modify files.",
        "Every proposed value should cite supplied passage ids when the value appears in a passage.",
        "Return one proposal object for every selected paper, even when its fields array is empty.",
        "Return only JSON with no Markdown fence or commentary.",
        "Schema: {\"proposals\":[{\"paperId\":\"...\",\"fields\":[{\"field\":\"title|authors|year|doi|arxivId|zoteroKey|tags\",\"proposedValue\":\"string, integer, string array, or null\",\"confidence\":0.0,\"rationale\":\"...\",\"evidencePassageIds\":[\"...\"]}]}]}",
        "authors and tags must be string arrays; year must be an integer; nullable identifiers may be strings or null.",
        "",
        `Workflow run id: ${runId}`,
        `Project: ${project?.name ?? "global library"}`,
        "",
        "Selected paper context:",
        paperContext || "No papers are selected."
      ].join("\n");
    }
    if (request.type === "key-findings") {
      const markdownBudgetPerPaper = Math.max(20_000, Math.floor(160_000 / Math.max(1, papers.length)));
      const findingsContext = papers
        .map((paper) => this.formatPaperForPrompt(paper, { passageLimit: 160, markdownChars: markdownBudgetPerPaper }))
        .join("\n\n");
      return [
        "You are LitAgent extracting structured research records from converted papers.",
        "Use only the supplied paper metadata, passages, and Markdown context. Do not modify files.",
        "Extract concise, non-duplicative items of these kinds: finding, method, dataset, result, limitation, reproducibility.",
        "Every item must cite one or more supplied passage ids that directly support its content.",
        "Keep measured values, dataset names, metrics, sample sizes, model names, and implementation details in attributes when available.",
        "Do not infer absent limitations or reproducibility claims. Omit unsupported items.",
        "Return one proposal object for every selected paper, even when its items array is empty.",
        "Return only JSON with no Markdown fence or commentary.",
        "Schema: {\"proposals\":[{\"paperId\":\"...\",\"items\":[{\"kind\":\"finding|method|dataset|result|limitation|reproducibility\",\"title\":\"...\",\"content\":\"...\",\"attributes\":{\"key\":\"value\"},\"confidence\":0.0,\"evidencePassageIds\":[\"...\"]}]}]}",
        "",
        `Workflow run id: ${runId}`,
        `Project: ${project?.name ?? "global library"}`,
        `Research question context: ${request.query ?? researchQuestions[0] ?? "none supplied"}`,
        "",
        "Selected paper context:",
        findingsContext || "No papers are selected."
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

  private formatPaperForPrompt(
    paper: Paper,
    options: { passageLimit?: number; markdownChars?: number } = {}
  ): string {
    const passages = this.repo.readPassages(paper.id).slice(0, options.passageLimit ?? 5);
    const markdown = this.repo.readMarkdown(paper.id);
    const markdownExcerpt = markdown
      ? options.markdownChars
        ? markdown.slice(0, options.markdownChars)
        : markdown.split("\n").slice(0, 80).join("\n")
      : "";
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
        if (!request.projectId) throw new Error("Relevance tagging requires a project scope.");
        const projectId = request.projectId;
        const project = this.repo.readProject(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);
        const researchQuestion = request.query
          ? project.researchQuestions.find((candidate) => candidate.text === request.query) ?? null
          : project.researchQuestions[0] ?? null;
        const question = request.query ?? researchQuestion?.text ?? "";
        if (!question.trim()) throw new Error("Relevance tagging requires a research question or query.");
        const proposals = papers.map((paper) => {
          const score = scoreRelevance(paper, question, this.repo.readMarkdown(paper.id) ?? "");
          const proposedState = proposedRelevanceState(score);
          let evidence = buildEvidence(
            this.index.search(this.repo, {
              query: question,
              projectId,
              paperId: paper.id,
              limit: 3
            }),
            3
          );
          if (evidence.length === 0) {
            evidence = this.repo.readPassages(paper.id).slice(0, 2).map((passage) => ({
              paperId: paper.id,
              passageId: passage.id,
              page: passage.page,
              paperTitle: paper.title,
              section: passage.section,
              quote: passage.quote,
              confidence: 0.35
            }));
          }
          const rationale = proposedState === "included"
            ? "The paper directly overlaps the research question in its metadata and converted text."
            : proposedState === "maybe"
              ? "The paper has partial topical overlap; review the linked passages before inclusion."
              : "The available metadata and converted text have little overlap with the research question.";
          const proposal = this.repo.createRelevanceProposal({
            runId,
            projectId,
            paperId: paper.id,
            researchQuestionId: researchQuestion?.id ?? null,
            question,
            proposedState,
            relevanceScore: score,
            confidence: evidence.length ? Math.max(0.4, Math.min(0.85, 0.5 + Math.abs(score - 0.3))) : 0.25,
            rationale,
            projectTags: [`rq:${slugify(researchQuestion?.id ?? question)}`],
            evidence,
            providerId: request.providerId,
            model: request.model
          });
          for (const item of proposal.evidence) {
            appendEvent(
              absoluteEventsPath,
              event({
                runId,
                providerId: request.providerId,
                type: "evidence.found",
                message: item.quote,
                payload: item
              })
            );
          }
          return proposal;
        });
        const outputPath = this.writeProjectOutput(
          request.projectId,
          `relevance-${slugify(runId)}.md`,
          [
            "# Relevance Proposals",
            "",
            `Research question: ${question}`,
            "",
            "These proposals do not change project screening state until they are accepted.",
            "",
            ...proposals.map((proposal) => {
              const paper = this.repo.readPaper(proposal.paperId);
              return `- **${proposal.proposedState}**: ${paper?.title ?? proposal.paperId} (${proposal.relevanceScore.toFixed(2)}) - ${proposal.rationale}`;
            })
          ].join("\n")
        );
        return { outputPath, proposalIds: proposals.map((proposal) => proposal.id), proposals };
      }
      case "metadata-extraction": {
        const proposals = papers.flatMap((paper) => {
          const inferred = inferMetadataFields(paper, this.repo.readMarkdown(paper.id) ?? "");
          const fields: MetadataFieldProposal[] = inferred.map((field) => {
            const queryValue = Array.isArray(field.proposedValue) ? field.proposedValue.join(" ") : String(field.proposedValue ?? "");
            const evidence = buildEvidence(
              this.index.search(this.repo, {
                query: queryValue,
                projectId: request.projectId,
                paperId: paper.id,
                limit: 2
              }),
              2
            );
            return {
              field: field.field,
              currentValue: paperMetadataValue(paper, field.field),
              proposedValue: field.proposedValue,
              confidence: evidence.length ? field.confidence : Math.min(field.confidence, 0.35),
              rationale: evidence.length ? field.rationale : `${field.rationale} No exact supporting passage was linked.`,
              evidence
            };
          });
          if (fields.length === 0) return [];
          const proposal = this.repo.createMetadataProposal({
            runId,
            projectId: request.projectId,
            paperId: paper.id,
            fields,
            providerId: request.providerId,
            model: request.model
          });
          for (const field of proposal.fields) {
            for (const item of field.evidence) {
              appendEvent(
                absoluteEventsPath,
                event({
                  runId,
                  providerId: request.providerId,
                  type: "evidence.found",
                  message: `${field.field}: ${item.quote}`,
                  payload: { ...item, metadataField: field.field }
                })
              );
            }
          }
          return [proposal];
        });
        const outputPath = this.writeProjectOutput(
          request.projectId,
          `metadata-${slugify(runId)}.md`,
          [
            "# Metadata Proposals",
            "",
            "These field changes do not update canonical paper metadata until they are accepted.",
            "",
            ...(proposals.length
              ? proposals.flatMap((proposal) => {
                  const paper = this.repo.readPaper(proposal.paperId);
                  return [
                    `## ${paper?.title ?? proposal.paperId}`,
                    ...proposal.fields.map((field) => `- **${field.field}**: ${JSON.stringify(field.currentValue)} -> ${JSON.stringify(field.proposedValue)} (${field.confidence.toFixed(2)})`),
                    ""
                  ];
                })
              : ["No metadata changes were detected in the selected sources."])
          ].join("\n")
        );
        return { outputPath, proposalIds: proposals.map((proposal) => proposal.id), proposals };
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
      case "key-findings": {
        const proposals = papers.flatMap((paper) => {
          const items = inferLocalResearchItems(this.repo, paper);
          if (items.length === 0) return [];
          const proposal = this.repo.createResearchFindingProposal({
            runId,
            projectId: request.projectId,
            paperId: paper.id,
            items,
            providerId: request.providerId,
            model: request.model
          });
          for (const item of proposal.items) {
            for (const evidence of item.evidence) {
              appendEvent(
                absoluteEventsPath,
                event({
                  runId,
                  providerId: request.providerId,
                  type: "evidence.found",
                  message: `${item.kind}: ${evidence.quote}`,
                  payload: { ...evidence, researchItemId: item.id, researchKind: item.kind }
                })
              );
            }
          }
          return [proposal];
        });
        const outputPath = this.writeProjectOutput(
          request.projectId,
          `key-findings-${slugify(runId)}.md`,
          [
            "# Research Record Proposals",
            "",
            "These findings do not become canonical research records until they are accepted.",
            "",
            ...(proposals.length
              ? proposals.flatMap((proposal) => {
                  const paper = this.repo.readPaper(proposal.paperId);
                  return [
                    `## ${paper?.title ?? proposal.paperId}`,
                    ...proposal.items.map((item) => `- **${item.kind} - ${item.title}:** ${item.content}`),
                    ""
                  ];
                })
              : ["No evidence-backed research items were found in the selected sources."])
          ].join("\n")
        );
        return { outputPath, proposalIds: proposals.map((proposal) => proposal.id), proposals };
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
