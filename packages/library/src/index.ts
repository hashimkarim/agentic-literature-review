import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import {
  CollectionSchema,
  ImportPaperRequestSchema,
  LinkPaperRequestSchema,
  PaperProjectLinkSchema,
  PaperSchema,
  PassageSchema,
  ProjectSchema,
  ResearchQuestionSchema,
  type Collection,
  type ImportPaperRequestInput,
  type LinkPaperRequestInput,
  type Paper,
  type PaperProjectLink,
  type Passage,
  type Project,
  type RelevanceState
} from "@litagent/contracts";

export const DEFAULT_REPO_ROOT = path.join(os.homedir(), ".litagent", "research-repo");

const linksArraySchema = z.array(PaperProjectLinkSchema);
const collectionsArraySchema = z.array(CollectionSchema);

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

function quoteBibTeX(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[{}]/g, "");
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
      ".litagent/cache/",
      ".litagent/thumbnails/",
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
