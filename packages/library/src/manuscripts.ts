import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  CreateManuscriptRequestSchema, DeleteManuscriptFileRequestSchema,
  ManuscriptPathSchema, ManuscriptSchema, WriteManuscriptFileRequestSchema,
  ManuscriptHistoryEntrySchema, ManuscriptCheckpointRequestSchema, RestoreManuscriptFileRequestSchema,
  WritingCandidateBatchSchema, type WritingCandidateBatch, type WritingCandidateSummary,
  type Manuscript, type ManuscriptDocument, type ManuscriptFile,
  type WriteManuscriptFileRequest, type ManuscriptHistoryEntry
} from "@litagent/contracts";

const MAX_FILE_BYTES = 250_000;
const MAX_DOCUMENT_BYTES = 2_000_000;

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

  private projectDirectory(projectId: string): string {
    ManuscriptSchema.shape.projectId.parse(projectId);
    const relative = `projects/${projectId}`;
    const projectFile = this.safePath(`${relative}/project.json`);
    if (!fs.existsSync(projectFile)) throw new ManuscriptError(404, "project_not_found", "Project not found.");
    return relative;
  }

  private directory(projectId: string, manuscriptId: string): string {
    ManuscriptSchema.shape.id.parse(manuscriptId);
    return `${this.projectDirectory(projectId)}/manuscripts/${manuscriptId}`;
  }

  private metadata(projectId: string, manuscriptId: string): Manuscript {
    const file = this.safePath(`${this.directory(projectId, manuscriptId)}/manuscript.json`);
    if (!fs.existsSync(file)) throw new ManuscriptError(404, "manuscript_not_found", "Manuscript not found.");
    const result = ManuscriptSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (result.id !== manuscriptId || result.projectId !== projectId) {
      throw new ManuscriptError(409, "manuscript_identity_changed", "Manuscript identity does not match its project.");
    }
    return result;
  }

  list(projectId: string): Manuscript[] {
    const directory = this.safePath(`${this.projectDirectory(projectId)}/manuscripts`);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((id) => ManuscriptSchema.shape.id.safeParse(id).success)
      .filter((id) => fs.existsSync(this.safePath(`${this.projectDirectory(projectId)}/manuscripts/${id}/manuscript.json`)))
      .map((id) => this.metadata(projectId, id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(projectId: string, input: { name: string }): ManuscriptDocument {
    const { name } = CreateManuscriptRequestSchema.parse(input);
    const id = `manuscript_${crypto.randomBytes(8).toString("hex")}`;
    const relative = `${this.projectDirectory(projectId)}/manuscripts/${id}`;
    const metadata: Manuscript = { id, projectId, name, entryFile: "main.tex", createdAt: new Date().toISOString() };
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
      for (const file of this.read(projectId, id).files) this.snapshot(projectId, id, file, "created");
    } catch (error) {
      fs.rmSync(path.dirname(directory), { recursive: true, force: true });
      throw error;
    }
    return this.read(projectId, id);
  }

  read(projectId: string, manuscriptId: string): ManuscriptDocument {
    const metadata = this.metadata(projectId, manuscriptId);
    const directory = this.directory(projectId, manuscriptId);
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

  writeFile(projectId: string, manuscriptId: string, input: WriteManuscriptFileRequest, reason: "saved" | "restored" | "candidate" = "saved"): ManuscriptFile {
    const parsed = WriteManuscriptFileRequestSchema.parse(input);
    const document = this.read(projectId, manuscriptId);
    const current = document.files.find((file) => file.path === parsed.path);
    if (!current && document.files.some((file) => file.path.toLowerCase() === parsed.path.toLowerCase())) {
      throw new ManuscriptError(409, "path_conflict", "A file already uses that name with different capitalization.");
    }
    if ((current?.revision ?? null) !== parsed.expectedRevision) {
      if (current?.content === parsed.content) { this.snapshot(projectId, manuscriptId, current, reason); return current; }
      throw new ManuscriptError(409, "manuscript_file_changed", "This file changed elsewhere. Review the saved version before saving again.");
    }
    const bytes = Buffer.byteLength(parsed.content);
    const total = document.files.filter((file) => file.path !== parsed.path).reduce((sum, file) => sum + Buffer.byteLength(file.content), bytes);
    if (bytes > MAX_FILE_BYTES || total > MAX_DOCUMENT_BYTES || (!current && document.files.length >= 64)) {
      throw new ManuscriptError(413, "manuscript_limit", "Manuscript sources exceed the file or size limit.");
    }
    const filePath = this.safePath(`${this.directory(projectId, manuscriptId)}/${parsed.path}`, true);
    if (current) this.snapshot(projectId, manuscriptId, current, "external");
    atomicWrite(filePath, parsed.content);
    const saved = { path: parsed.path, content: parsed.content, revision: revision(parsed.content) };
    this.snapshot(projectId, manuscriptId, saved, reason);
    return saved;
  }

  deleteFile(projectId: string, manuscriptId: string, input: { path: string; expectedRevision: string }): void {
    const parsed = DeleteManuscriptFileRequestSchema.parse(input);
    const document = this.read(projectId, manuscriptId);
    if (parsed.path === document.entryFile) throw new ManuscriptError(400, "entry_file_required", "The entry file cannot be deleted.");
    const current = document.files.find((file) => file.path === parsed.path);
    if (!current) throw new ManuscriptError(404, "file_not_found", "File not found.");
    if (current.revision !== parsed.expectedRevision) throw new ManuscriptError(409, "manuscript_file_changed", "This file changed elsewhere. Reload before deleting it.");
    this.snapshot(projectId, manuscriptId, current, "deleted");
    fs.unlinkSync(this.safePath(`${this.directory(projectId, manuscriptId)}/${parsed.path}`));
  }

  private historyIndex(projectId: string, manuscriptId: string, filePath: string): string {
    ManuscriptPathSchema.parse(filePath);
    return `${this.directory(projectId, manuscriptId)}/.history/${revision(filePath)}.json`;
  }

  history(projectId: string, manuscriptId: string, filePath: string): ManuscriptHistoryEntry[] {
    this.metadata(projectId, manuscriptId);
    const index = this.safePath(this.historyIndex(projectId, manuscriptId, filePath));
    const entries = fs.existsSync(index) ? z.array(ManuscriptHistoryEntrySchema).parse(JSON.parse(fs.readFileSync(index, "utf8"))) : [];
    if (entries.some((entry) => entry.path !== filePath)) throw new ManuscriptError(409, "history_changed", "History does not match the requested file.");
    return entries.reverse();
  }

  private snapshot(projectId: string, manuscriptId: string, file: ManuscriptFile, reason: ManuscriptHistoryEntry["reason"], label: string | null = null): ManuscriptHistoryEntry {
    const entries = this.history(projectId, manuscriptId, file.path);
    if (entries[0]?.revision === file.revision && reason !== "checkpoint" && reason !== "deleted" && reason !== "restored") return entries[0];
    const blob = this.safePath(`${this.directory(projectId, manuscriptId)}/.history/blobs/${file.revision}.json`, true);
    if (!fs.existsSync(blob)) atomicWrite(blob, JSON.stringify(file.content));
    const entry: ManuscriptHistoryEntry = { id: `version_${crypto.randomBytes(8).toString("hex")}`, path: file.path, revision: file.revision, savedAt: new Date().toISOString(), reason, label };
    entries.unshift(entry);
    atomicWrite(this.safePath(this.historyIndex(projectId, manuscriptId, file.path), true), `${JSON.stringify(entries.reverse(), null, 2)}\n`);
    return entry;
  }

  historicalFile(projectId: string, manuscriptId: string, filePath: string, versionId: string): ManuscriptFile {
    ManuscriptHistoryEntrySchema.shape.id.parse(versionId);
    const entry = this.history(projectId, manuscriptId, filePath).find((item) => item.id === versionId);
    if (!entry) throw new ManuscriptError(404, "version_not_found", "Saved version not found.");
    const blob = this.safePath(`${this.directory(projectId, manuscriptId)}/.history/blobs/${entry.revision}.json`);
    if (!fs.existsSync(blob)) throw new ManuscriptError(409, "version_unavailable", "Saved version contents are unavailable.");
    const content = z.string().parse(JSON.parse(fs.readFileSync(blob, "utf8")));
    if (revision(content) !== entry.revision) throw new ManuscriptError(409, "version_changed", "Saved version contents failed their integrity check.");
    return { path: filePath, content, revision: entry.revision };
  }

  checkpoint(projectId: string, manuscriptId: string, input: z.infer<typeof ManuscriptCheckpointRequestSchema>): ManuscriptHistoryEntry {
    const parsed = ManuscriptCheckpointRequestSchema.parse(input);
    const file = this.read(projectId, manuscriptId).files.find((item) => item.path === parsed.path);
    if (!file || file.revision !== parsed.expectedRevision) throw new ManuscriptError(409, "manuscript_file_changed", "File changed before the checkpoint. Reload first.");
    return this.snapshot(projectId, manuscriptId, file, "checkpoint", parsed.label);
  }

  restore(projectId: string, manuscriptId: string, input: z.infer<typeof RestoreManuscriptFileRequestSchema>): ManuscriptFile {
    const parsed = RestoreManuscriptFileRequestSchema.parse(input);
    const saved = this.historicalFile(projectId, manuscriptId, parsed.path, parsed.versionId);
    return this.writeFile(projectId, manuscriptId, { path: parsed.path, content: saved.content, expectedRevision: parsed.expectedRevision }, "restored");
  }

  private candidatePath(projectId: string, manuscriptId: string, batchId: string): string {
    this.metadata(projectId, manuscriptId);
    WritingCandidateBatchSchema.shape.id.parse(batchId);
    return `${this.directory(projectId, manuscriptId)}/.candidates/${batchId}.json`;
  }

  candidateBatch(projectId: string, manuscriptId: string, batchId: string): WritingCandidateBatch | null {
    const file = this.safePath(this.candidatePath(projectId, manuscriptId, batchId));
    if (!fs.existsSync(file)) return null;
    const batch = WritingCandidateBatchSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (batch.id !== batchId || batch.projectId !== projectId || batch.manuscriptId !== manuscriptId) {
      throw new ManuscriptError(409, "candidate_identity_changed", "Candidate identity does not match this manuscript.");
    }
    return batch;
  }

  saveCandidateBatch(input: WritingCandidateBatch): void {
    const batch = WritingCandidateBatchSchema.parse(input);
    atomicWrite(this.safePath(this.candidatePath(batch.projectId, batch.manuscriptId, batch.id), true), `${JSON.stringify(batch, null, 2)}\n`);
  }

  candidateBatches(projectId: string, manuscriptId: string): WritingCandidateSummary[] {
    this.metadata(projectId, manuscriptId);
    const directory = this.safePath(`${this.directory(projectId, manuscriptId)}/.candidates`);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((file) => /^candidates_[a-f0-9]{32}\.json$/.test(file)).map((file) => {
      const batch = this.candidateBatch(projectId, manuscriptId, file.slice(0, -5))!;
      return { id: batch.id, createdAt: batch.createdAt, status: batch.status, accepted: batch.accepted, path: batch.request.path,
        instruction: batch.request.instruction, completed: batch.candidates.filter((item) => item.status === "completed").length, total: batch.candidates.length };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
