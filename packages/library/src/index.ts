import crypto from "node:crypto";
export { ManuscriptStore, ManuscriptError, assertWritingTextSafe, assertWritingSourceSafe } from "./manuscripts";
export { inspectManuscriptZip } from "./manuscript-import";
export { manuscriptLimits, ManuscriptTreeError } from "./manuscript-files";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import {
  AnnotationSchema,
  CitationTargetRequestSchema,
  CitationTargetSchema,
  CollectionSchema,
  CreateAnnotationRequestSchema,
  CreateNoteRequestSchema,
  ImportPaperRequestSchema,
  LinkPaperRequestSchema,
  MetadataProposalSchema,
  NoteSchema,
  NoteWithContentSchema,
  PaperProjectLinkSchema,
  PaperSchema,
  PassageSchema,
  ProjectSchema,
  RelevanceProposalSchema,
  ResearchFindingProposalSchema,
  ResearchItemSchema,
  ResearchQuestionSchema,
  ResearchRecordSchema,
  ReviewMetadataProposalRequestSchema,
  ReviewResearchFindingProposalRequestSchema,
  ReviewRelevanceProposalRequestSchema,
  UpdateAnnotationRequestSchema,
  UpdateNoteRequestSchema,
  type Annotation,
  type CitationTarget,
  type CitationTargetRequestInput,
  type Collection,
  type CreateAnnotationRequestInput,
  type CreateNoteRequestInput,
  type ImportPaperRequestInput,
  type LinkPaperRequestInput,
  type MetadataFieldName,
  type MetadataFieldProposal,
  type MetadataFieldValue,
  type MetadataProposal,
  type Note,
  type NoteWithContent,
  type Paper,
  type PaperProjectLink,
  type Passage,
  type Project,
  type ProposalReviewStatus,
  type ProposedRelevanceState,
  type RelevanceProposal,
  type RelevanceState,
  type ResearchFindingProposal,
  type ResearchItem,
  type ResearchRecord,
  type ReviewMetadataProposalRequestInput,
  type ReviewResearchFindingProposalRequestInput,
  type ReviewRelevanceProposalRequestInput,
  type EvidenceRef,
  type UpdateAnnotationRequestInput,
  type UpdateNoteRequestInput
} from "@litagent/contracts";

export const DEFAULT_REPO_ROOT = path.join(os.homedir(), ".litagent", "research-repo");

const linksArraySchema = z.array(PaperProjectLinkSchema);
const collectionsArraySchema = z.array(CollectionSchema);
const annotationsArraySchema = z.array(AnnotationSchema);
const researchRecordsArraySchema = z.array(ResearchRecordSchema);
const paperMetadataPatchSchema = PaperSchema.pick({
  title: true,
  authors: true,
  year: true,
  doi: true,
  arxivId: true,
  zoteroKey: true,
  tags: true
}).partial();

export interface ProjectWithDetails {
  project: Project;
  collections: Collection[];
  links: PaperProjectLink[];
}

export interface PaperWithProject {
  paper: Paper;
  link: PaperProjectLink | null;
}

export interface GitStatus {
  repoRoot: string;
  branch: string | null;
  clean: boolean;
  ahead: number;
  behind: number;
  gitAvailable: boolean;
  lfsAvailable: boolean;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function hashId(kind: string, value: string): string {
  return `${kind}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string, schema: z.ZodType<T>, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativeFrom(root: string, absolutePath: string | null): string | null {
  return absolutePath ? path.relative(root, absolutePath) : null;
}

function normalizeAuthors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item).trim()).filter(Boolean);
}

function mergeUnique(...values: string[][]): string[] {
  return [...new Set(values.flat().map((value) => value.trim()).filter(Boolean))];
}

function removeValue(values: string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value);
}

function quoteBibTeX(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[{}]/g, "");
}

function quotesMatch(first: string, second: string): boolean {
  const a = first.replace(/\s+/g, " ").trim();
  const b = second.replace(/\s+/g, " ").trim();
  return Boolean(a && b && a === b);
}

const noteFrontmatterPattern = /^---\n(?<json>[\s\S]*?)\n---\n?/;

function readNoteMarkdown(filePath: string): NoteWithContent {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(noteFrontmatterPattern);
  if (!match?.groups?.json) {
    throw new Error(`Note is missing LitAgent JSON frontmatter: ${filePath}`);
  }
  const note = NoteSchema.parse(JSON.parse(match.groups.json));
  return NoteWithContentSchema.parse({
    ...note,
    content: raw.slice(match[0].length)
  });
}

function writeNoteMarkdown(root: string, note: Note, content: string): void {
  const filePath = path.join(root, note.path);
  ensureDir(path.dirname(filePath));
  const frontmatter = JSON.stringify(note, null, 2);
  fs.writeFileSync(filePath, `---\n${frontmatter}\n---\n${content}`, "utf8");
}

export class CitationSourceChangedError extends Error {
  readonly code = "citation_source_changed";
  constructor() {
    super("This citation no longer matches the current document. The source may have been reconverted or removed. Ask again using the current sources.");
    this.name = "CitationSourceChangedError";
  }
}

export class LitAgentRepository {
  readonly root: string;

  constructor(root = DEFAULT_REPO_ROOT) {
    this.root = path.resolve(root);
  }

  init(): void {
    for (const dir of [
      "library/papers",
      "library/markdown",
      "library/passages",
      "projects",
      "workflows",
      "exports",
      "pdfs",
      ".litagent/cache",
      ".litagent/thumbnails"
    ]) {
      ensureDir(this.resolve(dir));
    }

    this.writeGitPolicy();
    if (!fs.existsSync(this.resolve(".git"))) {
      spawnSync("git", ["init"], { cwd: this.root, stdio: "ignore" });
    }
  }

  resolve(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  relative(absolutePath: string | null): string | null {
    return relativeFrom(this.root, absolutePath);
  }

  writeGitPolicy(): void {
    ensureDir(this.root);
    const attributes = [
      "*.pdf filter=lfs diff=lfs merge=lfs -text",
      "*.png filter=lfs diff=lfs merge=lfs -text",
      "*.jpg filter=lfs diff=lfs merge=lfs -text",
      "*.jpeg filter=lfs diff=lfs merge=lfs -text",
      "*.webp filter=lfs diff=lfs merge=lfs -text"
    ].join("\n");
    const ignore = [
      ".litagent/index.sqlite",
      ".litagent/*.sqlite",
      ".litagent/provider-settings.json",
      ".litagent/workflow-automations.json",
      ".litagent/cache/",
      ".litagent/tex-builds/",
      ".litagent/thumbnails/",
      "pdfs/",
      "*.tmp"
    ].join("\n");
    fs.writeFileSync(this.resolve(".gitattributes"), `${attributes}\n`, "utf8");
    fs.writeFileSync(this.resolve(".gitignore"), `${ignore}\n`, "utf8");
  }

  gitStatus(): GitStatus {
    const gitAvailable = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;
    const lfsAvailable = spawnSync("git", ["lfs", "version"], { stdio: "ignore" }).status === 0;
    if (!gitAvailable || !fs.existsSync(this.resolve(".git"))) {
      return {
        repoRoot: this.root,
        branch: null,
        clean: true,
        ahead: 0,
        behind: 0,
        gitAvailable,
        lfsAvailable
      };
    }

    const branchProc = spawnSync("git", ["branch", "--show-current"], {
      cwd: this.root,
      encoding: "utf8"
    });
    const statusProc = spawnSync("git", ["status", "--porcelain=v1", "--branch"], {
      cwd: this.root,
      encoding: "utf8"
    });
    const status = statusProc.stdout ?? "";
    const ahead = Number(status.match(/ahead (\d+)/)?.[1] ?? 0);
    const behind = Number(status.match(/behind (\d+)/)?.[1] ?? 0);
    const changed = status
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("##"));

    return {
      repoRoot: this.root,
      branch: branchProc.stdout.trim() || null,
      clean: changed.length === 0,
      ahead,
      behind,
      gitAvailable,
      lfsAvailable
    };
  }

  listProjects(): Project[] {
    const dir = this.resolve("projects");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((projectId) => this.readProject(projectId))
      .filter((project): project is Project => Boolean(project))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  readProject(projectId: string): Project | null {
    const filePath = this.resolve(`projects/${projectId}/project.json`);
    if (!fs.existsSync(filePath)) return null;
    return ProjectSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  getProjectDetails(projectId: string): ProjectWithDetails {
    const project = this.readProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return {
      project,
      collections: this.listCollections(projectId),
      links: this.listPaperLinks(projectId)
    };
  }

  createProject(input: {
    name: string;
    description?: string;
    defaultProvider?: string;
    researchQuestion?: string;
  }): Project {
    const timestamp = nowIso();
    const id = createId("project");
    const researchQuestions = input.researchQuestion
      ? [
          ResearchQuestionSchema.parse({
            id: createId("rq"),
            text: input.researchQuestion,
            inclusionCriteria: [],
            exclusionCriteria: [],
            createdAt: timestamp,
            updatedAt: timestamp
          })
        ]
      : [];
    const project = ProjectSchema.parse({
      id,
      name: input.name,
      description: input.description ?? "",
      defaultProvider: input.defaultProvider ?? "codex",
      researchQuestions,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJson(this.resolve(`projects/${id}/project.json`), project);
    writeJson(this.resolve(`projects/${id}/research-questions.json`), researchQuestions);
    writeJson(this.resolve(`projects/${id}/paper-links.json`), []);
    ensureDir(this.resolve(`projects/${id}/collections`));
    ensureDir(this.resolve(`projects/${id}/notes`));
    ensureDir(this.resolve(`projects/${id}/outputs`));
    return project;
  }

  listCollections(projectId: string): Collection[] {
    const dir = this.resolve(`projects/${projectId}/collections`);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => CollectionSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  createCollection(input: { projectId: string; name: string; parentId?: string | null }): Collection {
    if (!this.readProject(input.projectId)) throw new Error(`Project not found: ${input.projectId}`);
    const timestamp = nowIso();
    const collection = CollectionSchema.parse({
      id: createId("collection"),
      projectId: input.projectId,
      name: input.name,
      parentId: input.parentId ?? null,
      filters: {},
      paperIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJson(
      this.resolve(`projects/${input.projectId}/collections/${collection.id}.json`),
      collection
    );
    return collection;
  }

  listPapers(projectId?: string | null): PaperWithProject[] {
    const papers = this.listGlobalPapers();
    if (!projectId) return papers.map((paper) => ({ paper, link: null }));
    const linkByPaper = new Map(this.listPaperLinks(projectId).map((link) => [link.paperId, link]));
    return papers
      .filter((paper) => linkByPaper.has(paper.id))
      .map((paper) => ({ paper, link: linkByPaper.get(paper.id) ?? null }));
  }

  listGlobalPapers(): Paper[] {
    const dir = this.resolve("library/papers");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((paperId) => this.readPaper(paperId))
      .filter((paper): paper is Paper => Boolean(paper))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  readPaper(paperId: string): Paper | null {
    const filePath = this.resolve(`library/papers/${paperId}/metadata.json`);
    if (!fs.existsSync(filePath)) return null;
    return PaperSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  importPaper(input: ImportPaperRequestInput): PaperWithProject {
    const parsed = ImportPaperRequestSchema.parse(input);
    const sourcePath = parsed.sourcePath ? path.resolve(parsed.sourcePath) : null;
    if (sourcePath && !fs.existsSync(sourcePath)) throw new Error(`Source PDF not found: ${sourcePath}`);

    const fileHash = sourcePath ? sha256File(sourcePath) : null;
    const titleFromFile = sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : "Untitled paper";
    const metadata = parsed.metadata;
    const paperId =
      metadata.id ??
      (metadata.doi ? hashId("paper", `doi:${metadata.doi}`) : null) ??
      (metadata.arxivId ? hashId("paper", `arxiv:${metadata.arxivId}`) : null) ??
      (metadata.zoteroKey ? hashId("paper", `zotero:${metadata.zoteroKey}`) : null) ??
      (fileHash ? hashId("paper", `sha256:${fileHash}`) : createId("paper"));

    const existing = this.readPaper(paperId);
    const paperDir = this.resolve(`library/papers/${paperId}`);
    ensureDir(paperDir);

    let pdfPath = existing?.filePaths.pdf ?? null;
    if (sourcePath) {
      const destination = path.join(paperDir, "paper.pdf");
      fs.copyFileSync(sourcePath, destination);
      pdfPath = this.relative(destination);
    }

    const timestamp = nowIso();
    const paper = PaperSchema.parse({
      id: paperId,
      title: metadata.title ?? existing?.title ?? titleFromFile,
      authors: metadata.authors ?? existing?.authors ?? normalizeAuthors(metadata.authors),
      year: metadata.year ?? existing?.year ?? null,
      doi: metadata.doi ?? existing?.doi ?? null,
      arxivId: metadata.arxivId ?? existing?.arxivId ?? null,
      zoteroKey: metadata.zoteroKey ?? existing?.zoteroKey ?? null,
      tags: mergeUnique(existing?.tags ?? [], metadata.tags ?? []),
      filePaths: {
        pdf: pdfPath,
        markdown: existing?.filePaths.markdown ?? null,
        assets: existing?.filePaths.assets ?? null
      },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    writeJson(path.join(paperDir, "metadata.json"), paper);
    if (paper.zoteroKey) {
      writeJson(path.join(paperDir, "zotero.json"), { key: paper.zoteroKey, syncedAt: timestamp });
    }

    const link = parsed.projectId
      ? this.linkPaperToProject(paper.id, {
          projectId: parsed.projectId,
          subcollectionIds: parsed.subcollectionIds,
          projectTags: parsed.projectTags
        })
      : null;
    return { paper, link };
  }

  linkPaperToProject(paperId: string, request: LinkPaperRequestInput): PaperProjectLink {
    const parsed = LinkPaperRequestSchema.parse(request);
    const project = this.readProject(parsed.projectId);
    if (!project) throw new Error(`Project not found: ${parsed.projectId}`);
    if (!this.readPaper(paperId)) throw new Error(`Paper not found: ${paperId}`);

    const links = this.listPaperLinks(parsed.projectId);
    const timestamp = nowIso();
    const defaultProjectTag = `project:${slugify(project.name)}`;
    const existingIndex = links.findIndex((link) => link.paperId === paperId);
    const existing = existingIndex >= 0 ? links[existingIndex] : null;
    const next = PaperProjectLinkSchema.parse({
      paperId,
      projectId: parsed.projectId,
      subcollectionIds: mergeUnique(existing?.subcollectionIds ?? [], parsed.subcollectionIds),
      projectTags: mergeUnique(existing?.projectTags ?? [], [defaultProjectTag], parsed.projectTags),
      relevanceState: parsed.relevanceState ?? existing?.relevanceState ?? "unreviewed",
      notes: existing?.notes ?? [],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    if (existingIndex >= 0) links[existingIndex] = next;
    else links.push(next);
    this.writePaperLinks(parsed.projectId, links);

    for (const collectionId of next.subcollectionIds) {
      const collection = this.readCollection(parsed.projectId, collectionId);
      if (!collection) continue;
      collection.paperIds = mergeUnique(collection.paperIds, [paperId]);
      collection.updatedAt = timestamp;
      writeJson(this.resolve(`projects/${parsed.projectId}/collections/${collectionId}.json`), collection);
    }

    return next;
  }

  updateProjectLink(input: {
    projectId: string;
    paperId: string;
    relevanceState?: RelevanceState;
    projectTags?: string[];
  }): PaperProjectLink {
    const links = this.listPaperLinks(input.projectId);
    const index = links.findIndex((link) => link.paperId === input.paperId);
    if (index < 0) {
      return this.linkPaperToProject(input.paperId, {
        projectId: input.projectId,
        relevanceState: input.relevanceState ?? "unreviewed",
        projectTags: input.projectTags ?? []
      });
    }
    const current = links[index];
    if (!current) throw new Error(`Paper link not found: ${input.projectId}/${input.paperId}`);
    const updated = PaperProjectLinkSchema.parse({
      ...current,
      relevanceState: input.relevanceState ?? current.relevanceState,
      projectTags: mergeUnique(current.projectTags, input.projectTags ?? []),
      updatedAt: nowIso()
    });
    links[index] = updated;
    this.writePaperLinks(input.projectId, links);
    return updated;
  }

  listPaperLinks(projectId: string): PaperProjectLink[] {
    return readJson(this.resolve(`projects/${projectId}/paper-links.json`), linksArraySchema, []);
  }

  writePaperLinks(projectId: string, links: PaperProjectLink[]): void {
    writeJson(this.resolve(`projects/${projectId}/paper-links.json`), links);
  }

  listRelevanceProposals(
    projectId: string,
    filters: { paperId?: string | null; status?: ProposalReviewStatus | null } = {}
  ): RelevanceProposal[] {
    if (!this.readProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    const dir = this.resolve(`projects/${projectId}/proposals/relevance`);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => RelevanceProposalSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))))
      .filter((proposal) => !filters.paperId || proposal.paperId === filters.paperId)
      .filter((proposal) => !filters.status || proposal.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  readRelevanceProposal(projectId: string, proposalId: string): RelevanceProposal | null {
    const filePath = this.resolve(`projects/${projectId}/proposals/relevance/${proposalId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const proposal = RelevanceProposalSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return proposal.projectId === projectId ? proposal : null;
  }

  createRelevanceProposal(input: {
    runId: string;
    projectId: string;
    paperId: string;
    researchQuestionId?: string | null;
    question: string;
    proposedState: ProposedRelevanceState;
    relevanceScore: number;
    confidence: number;
    rationale: string;
    projectTags?: string[];
    evidence?: EvidenceRef[];
    providerId: string;
    model?: string | null;
  }): RelevanceProposal {
    const project = this.readProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    if (!this.readPaper(input.paperId)) throw new Error(`Paper not found: ${input.paperId}`);
    if (!this.listPaperLinks(input.projectId).some((link) => link.paperId === input.paperId)) {
      throw new Error(`Paper is not linked to project: ${input.projectId}/${input.paperId}`);
    }
    if (input.researchQuestionId && !project.researchQuestions.some((question) => question.id === input.researchQuestionId)) {
      throw new Error(`Research question not found: ${input.researchQuestionId}`);
    }
    const timestamp = nowIso();
    const proposal = RelevanceProposalSchema.parse({
      ...input,
      id: createId("proposal"),
      researchQuestionId: input.researchQuestionId ?? null,
      projectTags: input.projectTags ?? [],
      evidence: input.evidence ?? [],
      model: input.model ?? null,
      status: "pending",
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJson(this.resolve(`projects/${input.projectId}/proposals/relevance/${proposal.id}.json`), proposal);
    return proposal;
  }

  reviewRelevanceProposal(
    projectId: string,
    proposalId: string,
    input: ReviewRelevanceProposalRequestInput
  ): RelevanceProposal {
    const request = ReviewRelevanceProposalRequestSchema.parse(input);
    const current = this.readRelevanceProposal(projectId, proposalId);
    if (!current) throw new Error(`Relevance proposal not found: ${proposalId}`);
    if (current.status !== "pending") {
      if (current.status === request.decision) return current;
      throw new Error(`Relevance proposal has already been ${current.status}.`);
    }

    const reviewedAt = nowIso();
    const reviewed = RelevanceProposalSchema.parse({
      ...current,
      proposedState: request.proposedState ?? current.proposedState,
      rationale: request.rationale ?? current.rationale,
      projectTags: request.projectTags ?? current.projectTags,
      status: request.decision,
      reviewedAt,
      updatedAt: reviewedAt
    });
    if (reviewed.status === "accepted") {
      this.updateProjectLink({
        projectId,
        paperId: reviewed.paperId,
        relevanceState: reviewed.proposedState,
        projectTags: reviewed.projectTags
      });
    }
    writeJson(this.resolve(`projects/${projectId}/proposals/relevance/${proposalId}.json`), reviewed);
    return reviewed;
  }

  updatePaperMetadata(paperId: string, input: Record<string, unknown>): Paper {
    const current = this.readPaper(paperId);
    if (!current) throw new Error(`Paper not found: ${paperId}`);
    const patch = paperMetadataPatchSchema.parse(input);
    const updated = PaperSchema.parse({
      ...current,
      ...patch,
      tags: patch.tags ? mergeUnique(current.tags, patch.tags) : current.tags,
      id: current.id,
      filePaths: current.filePaths,
      createdAt: current.createdAt,
      updatedAt: nowIso()
    });
    writeJson(this.resolve(`library/papers/${paperId}/metadata.json`), updated);
    if (updated.zoteroKey) {
      writeJson(this.resolve(`library/papers/${paperId}/zotero.json`), { key: updated.zoteroKey, syncedAt: updated.updatedAt });
    }
    return updated;
  }

  listMetadataProposals(
    paperId: string,
    filters: { status?: ProposalReviewStatus | null } = {}
  ): MetadataProposal[] {
    if (!this.readPaper(paperId)) throw new Error(`Paper not found: ${paperId}`);
    const dir = this.resolve(`library/papers/${paperId}/proposals/metadata`);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => MetadataProposalSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))))
      .filter((proposal) => !filters.status || proposal.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  readMetadataProposal(paperId: string, proposalId: string): MetadataProposal | null {
    const filePath = this.resolve(`library/papers/${paperId}/proposals/metadata/${proposalId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const proposal = MetadataProposalSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return proposal.paperId === paperId ? proposal : null;
  }

  createMetadataProposal(input: {
    runId: string;
    projectId?: string | null;
    paperId: string;
    fields: MetadataFieldProposal[];
    providerId: string;
    model?: string | null;
  }): MetadataProposal {
    if (!this.readPaper(input.paperId)) throw new Error(`Paper not found: ${input.paperId}`);
    if (input.projectId && !this.listPaperLinks(input.projectId).some((link) => link.paperId === input.paperId)) {
      throw new Error(`Paper is not linked to project: ${input.projectId}/${input.paperId}`);
    }
    const fieldNames = new Set<MetadataFieldName>();
    for (const field of input.fields) {
      if (fieldNames.has(field.field)) throw new Error(`Duplicate metadata field proposal: ${field.field}`);
      fieldNames.add(field.field);
      paperMetadataPatchSchema.parse({ [field.field]: field.proposedValue });
    }
    const timestamp = nowIso();
    const proposal = MetadataProposalSchema.parse({
      ...input,
      id: createId("proposal"),
      projectId: input.projectId ?? null,
      model: input.model ?? null,
      status: "pending",
      appliedFields: [],
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJson(this.resolve(`library/papers/${input.paperId}/proposals/metadata/${proposal.id}.json`), proposal);
    return proposal;
  }

  reviewMetadataProposal(
    paperId: string,
    proposalId: string,
    input: ReviewMetadataProposalRequestInput
  ): MetadataProposal {
    const request = ReviewMetadataProposalRequestSchema.parse(input);
    const current = this.readMetadataProposal(paperId, proposalId);
    if (!current) throw new Error(`Metadata proposal not found: ${proposalId}`);
    if (current.status !== "pending") {
      if (current.status === request.decision) return current;
      throw new Error(`Metadata proposal has already been ${current.status}.`);
    }

    const availableFields = new Set(current.fields.map((field) => field.field));
    const acceptedFields = request.decision === "accepted"
      ? request.acceptedFields ?? current.fields.map((field) => field.field)
      : [];
    if (acceptedFields.some((field) => !availableFields.has(field))) {
      throw new Error("Metadata review includes a field that is not part of the proposal.");
    }
    if (request.decision === "accepted" && acceptedFields.length === 0) {
      throw new Error("Accepting a metadata proposal requires at least one field.");
    }

    const editedFields = current.fields.map((field) => ({
      ...field,
      proposedValue: field.field in request.edits
        ? request.edits[field.field] as MetadataFieldValue
        : field.proposedValue
    }));
    if (request.decision === "accepted") {
      const patch = Object.fromEntries(
        editedFields
          .filter((field) => acceptedFields.includes(field.field))
          .map((field) => [field.field, field.proposedValue])
      );
      this.updatePaperMetadata(paperId, patch);
    }

    const reviewedAt = nowIso();
    const reviewed = MetadataProposalSchema.parse({
      ...current,
      fields: editedFields,
      status: request.decision,
      appliedFields: acceptedFields,
      reviewedAt,
      updatedAt: reviewedAt
    });
    writeJson(this.resolve(`library/papers/${paperId}/proposals/metadata/${proposalId}.json`), reviewed);
    return reviewed;
  }

  listResearchFindingProposals(
    paperId: string,
    filters: { projectId?: string | null; status?: ProposalReviewStatus | null } = {}
  ): ResearchFindingProposal[] {
    if (!this.readPaper(paperId)) throw new Error(`Paper not found: ${paperId}`);
    const dir = this.resolve(`library/papers/${paperId}/proposals/findings`);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ResearchFindingProposalSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))))
      .filter((proposal) => filters.projectId === undefined || proposal.projectId === filters.projectId)
      .filter((proposal) => !filters.status || proposal.status === filters.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  readResearchFindingProposal(paperId: string, proposalId: string): ResearchFindingProposal | null {
    const filePath = this.resolve(`library/papers/${paperId}/proposals/findings/${proposalId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const proposal = ResearchFindingProposalSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return proposal.paperId === paperId ? proposal : null;
  }

  createResearchFindingProposal(input: {
    runId: string;
    projectId?: string | null;
    paperId: string;
    items: ResearchItem[];
    providerId: string;
    model?: string | null;
  }): ResearchFindingProposal {
    if (!this.readPaper(input.paperId)) throw new Error(`Paper not found: ${input.paperId}`);
    if (input.projectId && !this.listPaperLinks(input.projectId).some((link) => link.paperId === input.paperId)) {
      throw new Error(`Paper is not linked to project: ${input.projectId}/${input.paperId}`);
    }
    const passages = new Set(this.readPassages(input.paperId).map((passage) => passage.id));
    const itemIds = new Set<string>();
    for (const item of input.items) {
      if (itemIds.has(item.id)) throw new Error(`Duplicate research item id: ${item.id}`);
      itemIds.add(item.id);
      if (item.evidence.some((evidence) => evidence.paperId !== input.paperId || !passages.has(evidence.passageId))) {
        throw new Error(`Research item evidence is outside paper scope: ${item.id}`);
      }
    }
    const timestamp = nowIso();
    const proposal = ResearchFindingProposalSchema.parse({
      ...input,
      id: createId("proposal"),
      projectId: input.projectId ?? null,
      model: input.model ?? null,
      status: "pending",
      acceptedItemIds: [],
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    writeJson(this.resolve(`library/papers/${input.paperId}/proposals/findings/${proposal.id}.json`), proposal);
    return proposal;
  }

  listResearchRecords(paperId: string, projectId?: string | null): ResearchRecord[] {
    if (!this.readPaper(paperId)) throw new Error(`Paper not found: ${paperId}`);
    const records = readJson(
      this.resolve(`library/papers/${paperId}/findings.json`),
      researchRecordsArraySchema,
      []
    );
    return records
      .filter((record) => projectId === undefined || record.projectId === null || record.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  reviewResearchFindingProposal(
    paperId: string,
    proposalId: string,
    input: ReviewResearchFindingProposalRequestInput
  ): ResearchFindingProposal {
    const request = ReviewResearchFindingProposalRequestSchema.parse(input);
    const current = this.readResearchFindingProposal(paperId, proposalId);
    if (!current) throw new Error(`Research findings proposal not found: ${proposalId}`);
    if (current.status !== "pending") {
      if (current.status === request.decision) return current;
      throw new Error(`Research findings proposal has already been ${current.status}.`);
    }

    const availableItemIds = new Set(current.items.map((item) => item.id));
    const acceptedItemIds = request.decision === "accepted"
      ? request.acceptedItemIds ?? current.items.map((item) => item.id)
      : [];
    if (acceptedItemIds.some((itemId) => !availableItemIds.has(itemId))) {
      throw new Error("Research findings review includes an item that is not part of the proposal.");
    }
    if (request.decision === "accepted" && acceptedItemIds.length === 0) {
      throw new Error("Accepting research findings requires at least one item.");
    }

    const editedItems = current.items.map((item) => ResearchItemSchema.parse({
      ...item,
      ...(request.edits[item.id] ?? {})
    }));
    if (request.decision === "accepted") {
      const timestamp = nowIso();
      const existing = this.listResearchRecords(paperId);
      const records = [...existing];
      for (const item of editedItems.filter((candidate) => acceptedItemIds.includes(candidate.id))) {
        const duplicateIndex = records.findIndex(
          (record) => record.sourceProposalId === current.id && record.sourceItemId === item.id
        );
        const record = ResearchRecordSchema.parse({
          ...item,
          id: duplicateIndex >= 0 ? records[duplicateIndex]?.id : createId("record"),
          paperId,
          projectId: current.projectId,
          sourceRunId: current.runId,
          sourceProposalId: current.id,
          sourceItemId: item.id,
          createdAt: duplicateIndex >= 0 ? records[duplicateIndex]?.createdAt : timestamp,
          updatedAt: timestamp
        });
        if (duplicateIndex >= 0) records[duplicateIndex] = record;
        else records.push(record);
      }
      writeJson(this.resolve(`library/papers/${paperId}/findings.json`), records);
    }

    const reviewedAt = nowIso();
    const reviewed = ResearchFindingProposalSchema.parse({
      ...current,
      items: editedItems,
      status: request.decision,
      acceptedItemIds,
      reviewedAt,
      updatedAt: reviewedAt
    });
    writeJson(this.resolve(`library/papers/${paperId}/proposals/findings/${proposalId}.json`), reviewed);
    return reviewed;
  }

  listNotes(projectId: string): Note[] {
    if (!this.readProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    const dir = this.resolve(`projects/${projectId}/notes`);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => readNoteMarkdown(path.join(dir, file)))
      .map(({ content: _content, ...note }) => note)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  readNote(projectId: string, noteId: string): NoteWithContent | null {
    const filePath = this.resolve(`projects/${projectId}/notes/${noteId}.md`);
    if (!fs.existsSync(filePath)) return null;
    const note = readNoteMarkdown(filePath);
    if (note.projectId !== projectId || note.id !== noteId) {
      throw new Error(`Note metadata does not match path: ${projectId}/${noteId}`);
    }
    return note;
  }

  createNote(projectId: string, input: CreateNoteRequestInput): NoteWithContent {
    if (!this.readProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    const parsed = CreateNoteRequestSchema.parse(input);
    if (parsed.paperId && !this.readPaper(parsed.paperId)) throw new Error(`Paper not found: ${parsed.paperId}`);
    const timestamp = nowIso();
    const note = NoteSchema.parse({
      id: createId("note"),
      projectId,
      title: parsed.title,
      path: "",
      paperId: parsed.paperId,
      passageIds: parsed.passageIds,
      annotationIds: parsed.annotationIds,
      workflowRunIds: parsed.workflowRunIds,
      researchQuestionIds: parsed.researchQuestionIds,
      tags: parsed.tags,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const noteWithPath = NoteSchema.parse({
      ...note,
      path: `projects/${projectId}/notes/${note.id}.md`
    });
    const content = parsed.content || `# ${parsed.title}\n`;
    writeNoteMarkdown(this.root, noteWithPath, content.endsWith("\n") ? content : `${content}\n`);
    this.syncNoteReferences(noteWithPath);
    return NoteWithContentSchema.parse({ ...noteWithPath, content: this.readNote(projectId, note.id)?.content ?? content });
  }

  updateNote(projectId: string, noteId: string, input: UpdateNoteRequestInput): NoteWithContent {
    const current = this.readNote(projectId, noteId);
    if (!current) throw new Error(`Note not found: ${projectId}/${noteId}`);
    const parsed = UpdateNoteRequestSchema.parse(input);
    if (parsed.paperId && !this.readPaper(parsed.paperId)) throw new Error(`Paper not found: ${parsed.paperId}`);
    const updated = NoteSchema.parse({
      ...current,
      title: parsed.title ?? current.title,
      paperId: parsed.paperId !== undefined ? parsed.paperId : current.paperId,
      passageIds: parsed.passageIds ?? current.passageIds,
      annotationIds: parsed.annotationIds ?? current.annotationIds,
      workflowRunIds: parsed.workflowRunIds ?? current.workflowRunIds,
      researchQuestionIds: parsed.researchQuestionIds ?? current.researchQuestionIds,
      tags: parsed.tags ?? current.tags,
      updatedAt: nowIso()
    });
    const content = parsed.content !== undefined ? parsed.content : current.content;
    writeNoteMarkdown(this.root, updated, content.endsWith("\n") ? content : `${content}\n`);
    if (current.paperId && current.paperId !== updated.paperId) {
      this.removeNoteFromPaperLink(projectId, current.paperId, noteId);
    }
    this.syncNoteReferences(updated);
    return NoteWithContentSchema.parse({ ...updated, content: this.readNote(projectId, noteId)?.content ?? content });
  }

  deleteNote(projectId: string, noteId: string): { deleted: true } {
    const note = this.readNote(projectId, noteId);
    if (!note) throw new Error(`Note not found: ${projectId}/${noteId}`);
    const annotations = this.listAnnotations(projectId).map((annotation) =>
      annotation.noteId === noteId ? AnnotationSchema.parse({ ...annotation, noteId: null, updatedAt: nowIso() }) : annotation
    );
    this.writeAnnotations(projectId, annotations);
    const links = this.listPaperLinks(projectId).map((link) =>
      PaperProjectLinkSchema.parse({ ...link, notes: removeValue(link.notes, noteId), updatedAt: nowIso() })
    );
    this.writePaperLinks(projectId, links);
    fs.rmSync(this.resolve(note.path), { force: true });
    return { deleted: true };
  }

  listAnnotations(projectId: string, paperId?: string | null): Annotation[] {
    if (!this.readProject(projectId)) throw new Error(`Project not found: ${projectId}`);
    const annotations = readJson(this.annotationsPath(projectId), annotationsArraySchema, []);
    return annotations
      .filter((annotation) => !paperId || annotation.paperId === paperId)
      .sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  }

  readAnnotation(projectId: string, annotationId: string): Annotation | null {
    return this.listAnnotations(projectId).find((annotation) => annotation.id === annotationId) ?? null;
  }

  createAnnotation(input: CreateAnnotationRequestInput): Annotation {
    const parsed = CreateAnnotationRequestSchema.parse(input);
    if (!this.readProject(parsed.projectId)) throw new Error(`Project not found: ${parsed.projectId}`);
    if (!this.readPaper(parsed.paperId)) throw new Error(`Paper not found: ${parsed.paperId}`);
    if (parsed.noteId && !this.readNote(parsed.projectId, parsed.noteId)) {
      throw new Error(`Note not found: ${parsed.projectId}/${parsed.noteId}`);
    }
    this.ensurePaperLinked(parsed.projectId, parsed.paperId);
    const timestamp = nowIso();
    const annotation = AnnotationSchema.parse({
      id: createId("annotation"),
      paperId: parsed.paperId,
      projectId: parsed.projectId,
      page: parsed.page,
      rects: parsed.rects,
      quote: parsed.quote,
      color: parsed.color,
      noteId: parsed.noteId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.writeAnnotations(parsed.projectId, [...this.listAnnotations(parsed.projectId), annotation]);
    if (annotation.noteId) {
      const note = this.readNote(parsed.projectId, annotation.noteId);
      if (note) {
        this.updateNote(parsed.projectId, note.id, {
          paperId: note.paperId ?? annotation.paperId,
          annotationIds: mergeUnique(note.annotationIds, [annotation.id])
        });
      }
    }
    return annotation;
  }

  updateAnnotation(projectId: string, annotationId: string, input: UpdateAnnotationRequestInput): Annotation {
    const parsed = UpdateAnnotationRequestSchema.parse(input);
    if (parsed.noteId && !this.readNote(projectId, parsed.noteId)) {
      throw new Error(`Note not found: ${projectId}/${parsed.noteId}`);
    }
    const annotations = this.listAnnotations(projectId);
    const index = annotations.findIndex((annotation) => annotation.id === annotationId);
    if (index < 0) throw new Error(`Annotation not found: ${projectId}/${annotationId}`);
    const current = annotations[index];
    if (!current) throw new Error(`Annotation not found: ${projectId}/${annotationId}`);
    const updated = AnnotationSchema.parse({
      ...current,
      page: parsed.page ?? current.page,
      rects: parsed.rects ?? current.rects,
      quote: parsed.quote ?? current.quote,
      color: parsed.color ?? current.color,
      noteId: parsed.noteId !== undefined ? parsed.noteId : current.noteId,
      updatedAt: nowIso()
    });
    annotations[index] = updated;
    this.writeAnnotations(projectId, annotations);
    if (current.noteId && current.noteId !== updated.noteId) {
      const previousNote = this.readNote(projectId, current.noteId);
      if (previousNote) this.updateNote(projectId, previousNote.id, { annotationIds: removeValue(previousNote.annotationIds, annotationId) });
    }
    if (updated.noteId) {
      const note = this.readNote(projectId, updated.noteId);
      if (note) {
        this.updateNote(projectId, note.id, {
          paperId: note.paperId ?? updated.paperId,
          annotationIds: mergeUnique(note.annotationIds, [updated.id])
        });
      }
    }
    return updated;
  }

  deleteAnnotation(projectId: string, annotationId: string): { deleted: true } {
    const annotations = this.listAnnotations(projectId);
    const annotation = annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) throw new Error(`Annotation not found: ${projectId}/${annotationId}`);
    this.writeAnnotations(projectId, annotations.filter((candidate) => candidate.id !== annotationId));
    if (annotation.noteId) {
      const note = this.readNote(projectId, annotation.noteId);
      if (note) this.updateNote(projectId, note.id, { annotationIds: removeValue(note.annotationIds, annotationId) });
    }
    return { deleted: true };
  }

  readCollection(projectId: string, collectionId: string): Collection | null {
    const filePath = this.resolve(`projects/${projectId}/collections/${collectionId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return CollectionSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  }

  readMarkdown(paperId: string): string | null {
    const paper = this.readPaper(paperId);
    const markdownPath = paper?.filePaths.markdown ? this.resolve(paper.filePaths.markdown) : null;
    if (!markdownPath || !fs.existsSync(markdownPath)) return null;
    return fs.readFileSync(markdownPath, "utf8");
  }

  writeMarkdown(paperId: string, markdown: string): { markdownPath: string; passages: Passage[] } {
    const paper = this.readPaper(paperId);
    if (!paper) throw new Error(`Paper not found: ${paperId}`);
    const markdownDir = this.resolve(`library/markdown/${paperId}`);
    ensureDir(markdownDir);
    const markdownPath = path.join(markdownDir, "paper.md");
    fs.writeFileSync(markdownPath, markdown, "utf8");
    const passages = parseMarkdownPassages(paperId, markdown);
    this.writePassages(paperId, passages);
    const updated = PaperSchema.parse({
      ...paper,
      filePaths: {
        ...paper.filePaths,
        markdown: this.relative(markdownPath),
        assets: this.relative(path.join(markdownDir, "assets"))
      },
      updatedAt: nowIso()
    });
    writeJson(this.resolve(`library/papers/${paperId}/metadata.json`), updated);
    return { markdownPath: this.relative(markdownPath) ?? markdownPath, passages };
  }

  readPassages(paperId: string): Passage[] {
    const filePath = this.resolve(`library/passages/${paperId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => PassageSchema.parse(JSON.parse(line)));
  }

  resolveCitationTarget(input: CitationTargetRequestInput): CitationTarget {
    const parsed = CitationTargetRequestSchema.parse(input);
    const paper = this.readPaper(parsed.paperId);
    const guarded = parsed.expectedQuote !== undefined || Boolean(parsed.expectedMarkdownHash);
    if (!paper && guarded) throw new CitationSourceChangedError();
    if (!paper) throw new Error(`Paper not found: ${parsed.paperId}`);
    if (parsed.expectedMarkdownHash) {
      const markdown = this.readMarkdown(parsed.paperId);
      if (markdown === null || crypto.createHash("sha256").update(markdown).digest("hex") !== parsed.expectedMarkdownHash) {
        throw new CitationSourceChangedError();
      }
    }
    const passage = this.readPassages(parsed.paperId).find((candidate) => candidate.id === parsed.passageId);
    if (!passage && guarded) throw new CitationSourceChangedError();
    if (!passage) throw new Error(`Passage not found: ${parsed.paperId}/${parsed.passageId}`);
    if (parsed.expectedQuote !== undefined && parsed.expectedQuote !== passage.quote) throw new CitationSourceChangedError();

    const annotations = parsed.projectId
      ? this.listAnnotations(parsed.projectId, parsed.paperId).filter(
          (annotation) =>
            annotation.page === passage.page &&
            quotesMatch(annotation.quote, passage.quote)
        )
      : [];
    const annotationRects = annotations.flatMap((annotation) => annotation.rects.filter((rect) => rect.page === passage.page));
    const rects = passage.rects.length > 0 ? passage.rects : annotationRects;
    const rectSource = passage.rects.length > 0 ? "passage" : annotationRects.length > 0 ? "annotation" : "none";

    return CitationTargetSchema.parse({
      paperId: parsed.paperId,
      passageId: parsed.passageId,
      projectId: parsed.projectId,
      paperTitle: paper.title,
      quote: passage.quote,
      page: passage.page,
      section: passage.section,
      pdf: {
        available: Boolean(paper.filePaths.pdf),
        path: paper.filePaths.pdf,
        url: null,
        page: passage.page,
        rects,
        rectSource
      },
      markdown: {
        available: Boolean(paper.filePaths.markdown),
        path: paper.filePaths.markdown,
        url: null,
        section: passage.section,
        startLine: passage.markdownStart === null ? null : passage.markdownStart + 1,
        endLine: passage.markdownEnd === null ? null : passage.markdownEnd
      },
      annotations
    });
  }

  writePassages(paperId: string, passages: Passage[]): void {
    const filePath = this.resolve(`library/passages/${paperId}.jsonl`);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, passages.map((passage) => JSON.stringify(passage)).join("\n") + "\n", "utf8");
  }

  pdfPath(paperId: string): string | null {
    const paper = this.readPaper(paperId);
    return paper?.filePaths.pdf ? this.resolve(paper.filePaths.pdf) : null;
  }

  exportBibTeX(projectId: string): string {
    const papers = this.listPapers(projectId).map((entry) => entry.paper);
    const used = new Set<string>();
    const entries = papers.map((paper) => {
      const authorStem = slugify(paper.authors[0] ?? "unknown").replaceAll("-", "");
      const titleStem = slugify(paper.title).split("-")[0] ?? "paper";
      const base = `${authorStem}${paper.year ?? "nd"}${titleStem}`;
      let citekey = base || paper.id;
      let suffix = 2;
      while (used.has(citekey)) citekey = `${base}${suffix++}`;
      used.add(citekey);
      const authors = paper.authors.join(" and ");
      return [
        `@article{${citekey},`,
        `  title = {${quoteBibTeX(paper.title)}},`,
        authors ? `  author = {${quoteBibTeX(authors)}},` : null,
        paper.year ? `  year = {${paper.year}},` : null,
        paper.doi ? `  doi = {${quoteBibTeX(paper.doi)}},` : null,
        paper.arxivId ? `  eprint = {${quoteBibTeX(paper.arxivId)}},` : null,
        `  note = {LitAgent paper id: ${paper.id}}`,
        `}`
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    });
    const output = entries.join("\n\n") + (entries.length ? "\n" : "");
    const exportPath = this.resolve(`exports/${projectId}.bib`);
    ensureDir(path.dirname(exportPath));
    fs.writeFileSync(exportPath, output, "utf8");
    return output;
  }

  private annotationsPath(projectId: string): string {
    return this.resolve(`projects/${projectId}/annotations.json`);
  }

  private writeAnnotations(projectId: string, annotations: Annotation[]): void {
    writeJson(this.annotationsPath(projectId), annotationsArraySchema.parse(annotations));
  }

  private ensurePaperLinked(projectId: string, paperId: string): void {
    if (!this.listPaperLinks(projectId).some((link) => link.paperId === paperId)) {
      this.linkPaperToProject(paperId, { projectId });
    }
  }

  private addNoteToPaperLink(projectId: string, paperId: string, noteId: string): void {
    this.ensurePaperLinked(projectId, paperId);
    const links = this.listPaperLinks(projectId);
    const index = links.findIndex((link) => link.paperId === paperId);
    if (index < 0) return;
    const current = links[index];
    if (!current) return;
    links[index] = PaperProjectLinkSchema.parse({
      ...current,
      notes: mergeUnique(current.notes, [noteId]),
      updatedAt: nowIso()
    });
    this.writePaperLinks(projectId, links);
  }

  private removeNoteFromPaperLink(projectId: string, paperId: string, noteId: string): void {
    const links = this.listPaperLinks(projectId);
    const index = links.findIndex((link) => link.paperId === paperId);
    if (index < 0) return;
    const current = links[index];
    if (!current) return;
    links[index] = PaperProjectLinkSchema.parse({
      ...current,
      notes: removeValue(current.notes, noteId),
      updatedAt: nowIso()
    });
    this.writePaperLinks(projectId, links);
  }

  private syncNoteReferences(note: Note): void {
    if (note.paperId) {
      this.addNoteToPaperLink(note.projectId, note.paperId, note.id);
    }
    if (note.annotationIds.length === 0) return;
    const annotationIds = new Set(note.annotationIds);
    const annotations = this.listAnnotations(note.projectId);
    let changed = false;
    const updated = annotations.map((annotation) => {
      if (!annotationIds.has(annotation.id) || annotation.noteId === note.id) return annotation;
      changed = true;
      return AnnotationSchema.parse({ ...annotation, noteId: note.id, updatedAt: nowIso() });
    });
    if (changed) this.writeAnnotations(note.projectId, updated);
  }

  seedDemoData(): void {
    if (this.listProjects().length > 0) return;
    const project = this.createProject({
      name: "Mobile MIR Literature Review",
      description: "Local-first review workspace for real-time music information retrieval papers.",
      researchQuestion:
        "Which model and dataset choices make mobile real-time music genre and rhythm analysis reliable?"
    });
    const models = this.createCollection({ projectId: project.id, name: "Models" });
    const datasets = this.createCollection({ projectId: project.id, name: "Datasets" });
    const papers = [
      {
        collectionId: models.id,
        metadata: {
          title: "BeatNet: CRNN and Particle Filtering for Online Joint Beat, Downbeat, and Meter Tracking",
          authors: ["Heydari", "Duan"],
          year: 2021,
          tags: ["beat tracking", "online", "particle filtering"]
        },
        markdown:
          "# BeatNet\n\nBeatNet combines a CRNN front-end with particle filtering for online joint beat, downbeat, and meter tracking.\n\n## Key Finding\n\nThe paper is relevant to real-time rhythm analysis because it reports streaming inference and online post-processing constraints.\n\n## Limitations\n\nMobile deployment is not the primary target, so device constraints need separate validation."
      },
      {
        collectionId: models.id,
        metadata: {
          title: "Music Classification Beyond Supervised Learning, Towards Real-world Applications",
          authors: ["Won", "Ferraro", "Bogdanov", "Serra"],
          year: 2021,
          tags: ["music classification", "tagging", "evaluation"]
        },
        markdown:
          "# Music Classification Beyond Supervised Learning\n\nThis survey reviews music classification and tagging systems for real-world applications.\n\n## Evaluation\n\nIt argues that supervised benchmark accuracy is not enough for deployment and that realistic data, noisy labels, and calibration matter.\n\n## Relevance\n\nThe paper is useful for metadata tagging, evaluation rubrics, and project-level comparison notes."
      },
      {
        collectionId: datasets.id,
        metadata: {
          title: "Salsa, a Dataset for Beat Estimation in Salsa Music",
          authors: ["Gomez-Marin", "Rapini", "Jordanous"],
          year: 2024,
          tags: ["dataset", "salsa", "beat estimation"]
        },
        markdown:
          "# Salsa Dataset\n\nThe dataset targets beat estimation in salsa music and addresses genre-specific rhythmic structure.\n\n## Dataset Contribution\n\nIt is relevant for underrepresented Latin music styles and can support stress-testing rhythm models outside common Western datasets.\n\n## Evidence Need\n\nA project should compare annotation protocol, size, and genre coverage against other beat tracking datasets."
      }
    ];

    for (const item of papers) {
      const imported = this.importPaper({
        projectId: project.id,
        subcollectionIds: [item.collectionId],
        projectTags: item.metadata.tags,
        metadata: item.metadata
      });
      this.writeMarkdown(imported.paper.id, item.markdown);
    }
  }
}

export function parseMarkdownPassages(paperId: string, markdown: string): Passage[] {
  const passages: Passage[] = [];
  const lines = markdown.split(/\r?\n/);
  let section = "Overview";
  let paragraph: string[] = [];
  let paragraphStart = 0;

  const flush = (lineIndex: number) => {
    const quote = paragraph.join(" ").trim();
    if (!quote) {
      paragraph = [];
      return;
    }
    const index = passages.length;
    passages.push(
      PassageSchema.parse({
        id: `${paperId}_passage_${String(index + 1).padStart(4, "0")}`,
        paperId,
        page: Math.floor(index / 8) + 1,
        section,
        markdownStart: paragraphStart,
        markdownEnd: lineIndex,
        quote,
        rects: []
      })
    );
    paragraph = [];
  };

  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush(index);
      section = heading[2]?.trim() ?? section;
      return;
    }
    if (!line.trim()) {
      flush(index);
      return;
    }
    if (paragraph.length === 0) paragraphStart = index;
    paragraph.push(line.trim());
  });
  flush(lines.length);
  return passages;
}
