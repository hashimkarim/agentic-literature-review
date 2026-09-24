import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CreateManuscriptRequestSchema, DeleteManuscriptFileRequestSchema,
  ManuscriptPathSchema, ManuscriptSchema, WriteManuscriptFileRequestSchema,
  ManuscriptHistoryEntrySchema, ManuscriptCheckpointRequestSchema, RestoreManuscriptFileRequestSchema,
  ManuscriptProjectIdSchema, UpdateManuscriptProjectsRequestSchema,
  WritingCandidateBatchSchema, type WritingCandidateBatch, type WritingCandidateSummary,
  type Manuscript, type ManuscriptDocument, type ManuscriptFile,
  type WriteManuscriptFileRequest, type ManuscriptHistoryEntry
} from "@litagent/contracts";

const MAX_FILE_BYTES = 250_000;
const MAX_DOCUMENT_BYTES = 2_000_000;
const LegacyManuscriptSchema = ManuscriptSchema.omit({ projectIds: true }).extend({ projectId: ManuscriptProjectIdSchema });

export class ManuscriptError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ManuscriptError";
  }
}

function revision(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function atomicWrite(filePath: string, content: string): void {
  const temporary = path.join(path.dirname(filePath), `.writing-${crypto.randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filePath);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

export class ManuscriptStore {
  readonly root: string;
  constructor(root: string) { this.root = fs.realpathSync(root); }

  // All components, including existing ancestors, are checked before reading or writing.
  private safePath(relative: string, createParents = false): string {
    const parts = relative.split("/");
    let current = this.root;
    for (const [index, part] of parts.entries()) {
      if (!part || part === "." || part === ".." || part.includes("\\")) {
        throw new ManuscriptError(400, "invalid_path", "Invalid manuscript path.");
      }
      current = path.join(current, part);
      let stat: fs.Stats | undefined;
      try { stat = fs.lstatSync(current); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (stat?.isSymbolicLink() || (stat && index < parts.length - 1 && !stat.isDirectory())) {
        throw new ManuscriptError(400, "unsafe_path", "Manuscript paths cannot contain links or non-directory parents.");
      }
      if (!stat && createParents && index < parts.length - 1) fs.mkdirSync(current);
    }
    return current;
  }

  private projectDirectory(linkedProjectId: string): string {
    ManuscriptProjectIdSchema.parse(linkedProjectId);
    const relative = `projects/${linkedProjectId}`;
    const projectFile = this.safePath(`${relative}/project.json`);
    if (!fs.existsSync(projectFile)) throw new ManuscriptError(404, "project_not_found", "Project not found.");
    return relative;
  }

  private directory(manuscriptId: string): string {
    ManuscriptSchema.shape.id.parse(manuscriptId);
    return `manuscripts/${manuscriptId}`;
  }

  private migrateLegacy(onlyId?: string): void {
    const projects = this.safePath("projects");
    if (!fs.existsSync(projects)) return;
    const pending: { source: string; target: string }[] = [];
    const ids = new Set<string>();
    for (const owner of fs.readdirSync(projects)) {
      if (!ManuscriptProjectIdSchema.safeParse(owner).success) continue;
      const directory = this.safePath(`projects/${owner}/manuscripts`);
      if (!fs.existsSync(directory)) continue;
      for (const id of fs.readdirSync(directory)) {
        if ((onlyId && id !== onlyId) || !ManuscriptSchema.shape.id.safeParse(id).success) continue;
        const source = this.safePath(`projects/${owner}/manuscripts/${id}`);
        const manifest = this.safePath(`projects/${owner}/manuscripts/${id}/manuscript.json`);
        if (!fs.existsSync(manifest)) continue;
        const legacy = LegacyManuscriptSchema.parse(JSON.parse(fs.readFileSync(manifest, "utf8")));
        if (legacy.id !== id || legacy.projectId !== owner) throw new ManuscriptError(409, "manuscript_identity_changed", "Legacy manuscript identity does not match its folder.");
        const target = this.safePath(this.directory(id));
        if (ids.has(id) || fs.existsSync(target)) throw new ManuscriptError(409, "manuscript_migration_conflict", "Two manuscript folders share an ID. Resolve the duplicate before migrating; neither copy was overwritten.");
        ids.add(id); pending.push({ source, target });
      }
    }
    // Move the complete folder atomically, including history and candidates. Metadata
    // upgrades on read, so a restart between rename and upgrade is recoverable.
    for (const { source, target } of pending) {
      this.safePath(`manuscripts/${path.basename(target)}`, true);
      fs.renameSync(source, target);
    }
  }

  private metadata(manuscriptId: string): Manuscript {
    const file = this.safePath(`${this.directory(manuscriptId)}/manuscript.json`);
    if (!fs.existsSync(file)) this.migrateLegacy(manuscriptId);
    if (!fs.existsSync(file)) throw new ManuscriptError(404, "manuscript_not_found", "Manuscript not found.");
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const legacy = LegacyManuscriptSchema.safeParse(raw);
    const result = ManuscriptSchema.parse(legacy.success && !("projectIds" in (raw as object))
      ? { ...legacy.data, projectIds: [legacy.data.projectId] } : raw);
    if (result.id !== manuscriptId) {
      throw new ManuscriptError(409, "manuscript_identity_changed", "Manuscript identity does not match its folder.");
    }
    if (legacy.success) atomicWrite(file, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  list(linkedProjectId?: string): Manuscript[] {
    if (linkedProjectId) this.projectDirectory(linkedProjectId);
    this.migrateLegacy();
    const directory = this.safePath("manuscripts");
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((id) => ManuscriptSchema.shape.id.safeParse(id).success)
      .filter((id) => fs.existsSync(this.safePath(`${this.directory(id)}/manuscript.json`)))
      .map((id) => this.metadata(id)).filter((item) => !linkedProjectId || item.projectIds.includes(linkedProjectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
  }

  create(input: z.input<typeof CreateManuscriptRequestSchema>): ManuscriptDocument {
    const { name, projectIds } = CreateManuscriptRequestSchema.parse(input);
    projectIds.forEach((id) => this.projectDirectory(id));
    const id = `manuscript_${crypto.randomBytes(8).toString("hex")}`;
    const relative = this.directory(id);
    const metadata: Manuscript = { id, projectIds: [...projectIds].sort(), name, entryFile: "main.tex", createdAt: new Date().toISOString() };
    const directory = this.safePath(`${relative}/manuscript.json`, true);
    try {
      fs.writeFileSync(this.safePath(`${relative}/main.tex`), [
        "\\documentclass{article}", "\\usepackage[utf8]{inputenc}", "\\usepackage{amsmath}",
        "\\usepackage{graphicx}", "\\usepackage{hyperref}", "", "\\title{Manuscript}",
        "\\author{}", "\\date{}", "", "\\begin{document}", "\\maketitle", "",
        "\\begin{abstract}", "", "\\end{abstract}", "", "\\input{sections/introduction}", "",
        "\\bibliographystyle{plain}", "\\bibliography{references}", "\\end{document}", ""
      ].join("\n"), { flag: "wx" });
      fs.writeFileSync(this.safePath(`${relative}/sections/introduction.tex`, true), "\\section{Introduction}\n\\label{sec:introduction}\n\n", { flag: "wx" });
      fs.writeFileSync(this.safePath(`${relative}/references.bib`), "", { flag: "wx" });
      // Publish the manifest last; interrupted creation is never listed as a valid manuscript.
      atomicWrite(directory, `${JSON.stringify(metadata, null, 2)}\n`);
      for (const file of this.read(id).files) this.snapshot(id, file, "created");
    } catch (error) {
      fs.rmSync(path.dirname(directory), { recursive: true, force: true });
      throw error;
    }
    return this.read(id);
  }

  updateProjects(manuscriptId: string, input: z.infer<typeof UpdateManuscriptProjectsRequestSchema>): Manuscript {
    const request = UpdateManuscriptProjectsRequestSchema.parse(input);
    const current = this.metadata(manuscriptId);
    const next = [...request.projectIds].sort();
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (same(current.projectIds, next)) return current;
    if (!same(current.projectIds, request.expectedProjectIds)) throw new ManuscriptError(409, "manuscript_links_changed", "Project links changed elsewhere. Reload them before saving again.");
    // Existing links can survive a deleted project; newly added links must exist.
    next.filter((id) => !current.projectIds.includes(id)).forEach((id) => this.projectDirectory(id));
    const updated = { ...current, projectIds: next };
    atomicWrite(this.safePath(`${this.directory(manuscriptId)}/manuscript.json`), `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  }

  read(manuscriptId: string): ManuscriptDocument {
    const metadata = this.metadata(manuscriptId);
    const directory = this.directory(manuscriptId);
    const files: ManuscriptFile[] = [];
    let bytes = 0;
    const walk = (prefix: string, depth: number) => {
      if (depth > 5) return;
      for (const entry of fs.readdirSync(this.safePath(`${directory}${prefix ? `/${prefix}` : ""}`), { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { walk(relative, depth + 1); continue; }
        if (!ManuscriptPathSchema.safeParse(relative).success) continue;
        const file = this.safePath(`${directory}/${relative}`);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES || files.length >= 64) {
          throw new ManuscriptError(413, "manuscript_limit", "Manuscript exceeds the 64-file or 250 KB per-file limit.");
        }
        bytes += stat.size;
        if (bytes > MAX_DOCUMENT_BYTES) throw new ManuscriptError(413, "manuscript_limit", "Manuscript sources exceed 2 MB.");
        const content = fs.readFileSync(file, "utf8");
        files.push({ path: relative, content, revision: revision(content) });
      }
    };
    walk("", 0);
    return { ...metadata, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  }

  writeFile(manuscriptId: string, input: WriteManuscriptFileRequest, reason: "saved" | "restored" | "candidate" = "saved"): ManuscriptFile {
    const parsed = WriteManuscriptFileRequestSchema.parse(input);
    const document = this.read(manuscriptId);
    const current = document.files.find((file) => file.path === parsed.path);
    if (!current && document.files.some((file) => file.path.toLowerCase() === parsed.path.toLowerCase())) {
      throw new ManuscriptError(409, "path_conflict", "A file already uses that name with different capitalization.");
    }
    if ((current?.revision ?? null) !== parsed.expectedRevision) {
      if (current?.content === parsed.content) { this.snapshot(manuscriptId, current, reason); return current; }
      throw new ManuscriptError(409, "manuscript_file_changed", "This file changed elsewhere. Review the saved version before saving again.");
    }
    const bytes = Buffer.byteLength(parsed.content);
    const total = document.files.filter((file) => file.path !== parsed.path).reduce((sum, file) => sum + Buffer.byteLength(file.content), bytes);
    if (bytes > MAX_FILE_BYTES || total > MAX_DOCUMENT_BYTES || (!current && document.files.length >= 64)) {
      throw new ManuscriptError(413, "manuscript_limit", "Manuscript sources exceed the file or size limit.");
    }
    const filePath = this.safePath(`${this.directory(manuscriptId)}/${parsed.path}`, true);
    if (current) this.snapshot(manuscriptId, current, "external");
    atomicWrite(filePath, parsed.content);
    const saved = { path: parsed.path, content: parsed.content, revision: revision(parsed.content) };
    this.snapshot(manuscriptId, saved, reason);
    return saved;
  }

  deleteFile(manuscriptId: string, input: { path: string; expectedRevision: string }): void {
    const parsed = DeleteManuscriptFileRequestSchema.parse(input);
    const document = this.read(manuscriptId);
    if (parsed.path === document.entryFile) throw new ManuscriptError(400, "entry_file_required", "The entry file cannot be deleted.");
    const current = document.files.find((file) => file.path === parsed.path);
    if (!current) throw new ManuscriptError(404, "file_not_found", "File not found.");
    if (current.revision !== parsed.expectedRevision) throw new ManuscriptError(409, "manuscript_file_changed", "This file changed elsewhere. Reload before deleting it.");
    this.snapshot(manuscriptId, current, "deleted");
    fs.unlinkSync(this.safePath(`${this.directory(manuscriptId)}/${parsed.path}`));
  }

  private historyIndex(manuscriptId: string, filePath: string): string {
    ManuscriptPathSchema.parse(filePath);
    return `${this.directory(manuscriptId)}/.history/${revision(filePath)}.json`;
  }

  history(manuscriptId: string, filePath: string): ManuscriptHistoryEntry[] {
    this.metadata(manuscriptId);
    const index = this.safePath(this.historyIndex(manuscriptId, filePath));
    const entries = fs.existsSync(index) ? z.array(ManuscriptHistoryEntrySchema).parse(JSON.parse(fs.readFileSync(index, "utf8"))) : [];
    if (entries.some((entry) => entry.path !== filePath)) throw new ManuscriptError(409, "history_changed", "History does not match the requested file.");
    return entries.reverse();
  }

  private snapshot(manuscriptId: string, file: ManuscriptFile, reason: ManuscriptHistoryEntry["reason"], label: string | null = null): ManuscriptHistoryEntry {
    const entries = this.history(manuscriptId, file.path);
    if (entries[0]?.revision === file.revision && reason !== "checkpoint" && reason !== "deleted" && reason !== "restored") return entries[0];
    const blob = this.safePath(`${this.directory(manuscriptId)}/.history/blobs/${file.revision}.json`, true);
    if (!fs.existsSync(blob)) atomicWrite(blob, JSON.stringify(file.content));
    const entry: ManuscriptHistoryEntry = { id: `version_${crypto.randomBytes(8).toString("hex")}`, path: file.path, revision: file.revision, savedAt: new Date().toISOString(), reason, label };
    entries.unshift(entry);
    atomicWrite(this.safePath(this.historyIndex(manuscriptId, file.path), true), `${JSON.stringify(entries.reverse(), null, 2)}\n`);
    return entry;
  }

  historicalFile(manuscriptId: string, filePath: string, versionId: string): ManuscriptFile {
    ManuscriptHistoryEntrySchema.shape.id.parse(versionId);
    const entry = this.history(manuscriptId, filePath).find((item) => item.id === versionId);
    if (!entry) throw new ManuscriptError(404, "version_not_found", "Saved version not found.");
    const blob = this.safePath(`${this.directory(manuscriptId)}/.history/blobs/${entry.revision}.json`);
    if (!fs.existsSync(blob)) throw new ManuscriptError(409, "version_unavailable", "Saved version contents are unavailable.");
    const content = z.string().parse(JSON.parse(fs.readFileSync(blob, "utf8")));
    if (revision(content) !== entry.revision) throw new ManuscriptError(409, "version_changed", "Saved version contents failed their integrity check.");
    return { path: filePath, content, revision: entry.revision };
  }

  checkpoint(manuscriptId: string, input: z.infer<typeof ManuscriptCheckpointRequestSchema>): ManuscriptHistoryEntry {
    const parsed = ManuscriptCheckpointRequestSchema.parse(input);
    const file = this.read(manuscriptId).files.find((item) => item.path === parsed.path);
    if (!file || file.revision !== parsed.expectedRevision) throw new ManuscriptError(409, "manuscript_file_changed", "File changed before the checkpoint. Reload first.");
    return this.snapshot(manuscriptId, file, "checkpoint", parsed.label);
  }

  restore(manuscriptId: string, input: z.infer<typeof RestoreManuscriptFileRequestSchema>): ManuscriptFile {
    const parsed = RestoreManuscriptFileRequestSchema.parse(input);
    const saved = this.historicalFile(manuscriptId, parsed.path, parsed.versionId);
    return this.writeFile(manuscriptId, { path: parsed.path, content: saved.content, expectedRevision: parsed.expectedRevision }, "restored");
  }

  private candidatePath(manuscriptId: string, batchId: string): string {
    this.metadata(manuscriptId);
    WritingCandidateBatchSchema.shape.id.parse(batchId);
    return `${this.directory(manuscriptId)}/.candidates/${batchId}.json`;
  }

  candidateBatch(manuscriptId: string, batchId: string): WritingCandidateBatch | null {
    const file = this.safePath(this.candidatePath(manuscriptId, batchId));
    if (!fs.existsSync(file)) return null;
    const batch = WritingCandidateBatchSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (batch.id !== batchId || batch.manuscriptId !== manuscriptId) {
      throw new ManuscriptError(409, "candidate_identity_changed", "Candidate identity does not match this manuscript.");
    }
    return batch;
  }

  saveCandidateBatch(input: WritingCandidateBatch): void {
    const batch = WritingCandidateBatchSchema.parse(input);
    atomicWrite(this.safePath(this.candidatePath(batch.manuscriptId, batch.id), true), `${JSON.stringify(batch, null, 2)}\n`);
  }

  candidateBatches(manuscriptId: string): WritingCandidateSummary[] {
    this.metadata(manuscriptId);
    const directory = this.safePath(`${this.directory(manuscriptId)}/.candidates`);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((file) => /^candidates_[a-f0-9]{32}\.json$/.test(file)).map((file) => {
      const batch = this.candidateBatch(manuscriptId, file.slice(0, -5))!;
      return { id: batch.id, createdAt: batch.createdAt, status: batch.status, accepted: batch.accepted, path: batch.request.path,
        instruction: batch.request.instruction, completed: batch.candidates.filter((item) => item.status === "completed").length, total: batch.candidates.length };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
