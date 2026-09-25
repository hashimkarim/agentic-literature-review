import fs from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { LocalFolderRequestSchema, ImportLocalEntrySchema, type LocalFolderPreview, type WritingAttachmentInput } from "@litagent/contracts";
import type { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { requireLocalAccess } from "./local-access";

const excluded = /^(node_modules|vendor|dist|build|out|target|__pycache__|venv|env|coverage|wandb|checkpoints)$/i;
const sensitive = /(^|[-_.])(secrets?|credentials?|passwords?|tokens?|private[-_]?keys?)([-_.]|$)/i;
const textExtension = /\.(ts|tsx|js|jsx|py|rs|go|c|h|cpp|hpp|java|r|jl|sql|md|txt|csv|tsv|json|yaml|yml|toml|tex|bib)$/i;
const stamp = (stat: Stats) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
type Preview = { public: LocalFolderPreview; files: Map<string, { path: string; stamp: string }> };

/** Short-lived, app-owned file grants. Preview never sends file content to a provider. */
export class LocalFolderImports {
  private readonly previews = new Map<string, Preview>();
  private scanning = false;
  async preview(input: unknown): Promise<LocalFolderPreview> {
    const request = LocalFolderRequestSchema.parse(input);
    if (this.scanning) throw new Error("A folder scan is already running. Try again when it finishes.");
    if (!path.isAbsolute(request.path)) throw new Error("Enter an absolute folder path.");
    this.scanning = true;
    try {
      const root = await fs.realpath(request.path);
      if (root === path.parse(root).root || path.basename(root).startsWith(".") || sensitive.test(path.basename(root)) || !(await fs.stat(root)).isDirectory()) throw new Error("Choose a document folder, not the filesystem root or a private configuration folder.");
      const result: LocalFolderPreview = { id: randomUUID(), root, kind: request.kind, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), files: [], skipped: 0, truncated: false };
      const files: Preview["files"] = new Map(); let visited = 0;
      const walk = async (relative: string, depth: number) => {
        if (depth > 24) { result.skipped++; return; }
        const entries = await fs.opendir(path.join(root, relative));
        for await (const entry of entries) {
          if (++visited > 30_000 || result.files.length >= 2000) { result.truncated = true; break; }
          if (entry.name.startsWith(".") || excluded.test(entry.name) || sensitive.test(entry.name) || entry.isSymbolicLink()) { result.skipped++; continue; }
          const name = path.join(relative, entry.name);
          try {
            if (entry.isDirectory()) { await walk(name, depth + 1); continue; }
            if (!entry.isFile() || !(request.kind === "pdf" ? /\.pdf$/i : textExtension).test(name)) { result.skipped++; continue; }
            const stat = await fs.lstat(path.join(root, name));
            if (!stat.isFile() || stat.size < 1 || stat.size > (request.kind === "pdf" ? 200_000_000 : 256_000)) { result.skipped++; continue; }
            const id = randomUUID(); files.set(id, { path: name, stamp: stamp(stat) });
            result.files.push({ id, path: name.split(path.sep).join("/"), bytes: stat.size });
          } catch { result.skipped++; }
        }
      };
      await walk("", 0);
      result.files.sort((a, b) => a.path.localeCompare(b.path));
      for (const [id, preview] of this.previews) if (Date.parse(preview.public.expiresAt) < Date.now()) this.previews.delete(id);
      while (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
      this.previews.set(result.id, { public: result, files }); return result;
    } finally { this.scanning = false; }
  }
  async read(previewId: string, entryId: string): Promise<{ path: string; originPath: string; kind: "pdf" | "sources"; bytes: Buffer }> {
    const preview = this.previews.get(previewId), entry = preview?.files.get(entryId);
    if (!preview || !entry || Date.parse(preview.public.expiresAt) < Date.now()) throw new Error("Folder preview expired. Scan again before importing.");
    const target = path.join(preview.public.root, entry.path);
    // Reject changed ancestors and links; an open descriptor and identity checks
    // keep later copying independent of a mutable original path.
    if (await fs.realpath(target) !== target) throw new Error("Source path changed. Scan the folder again.");
    const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (stamp(await file.stat()) !== entry.stamp) throw new Error("Source changed since preview. Scan the folder again.");
      const bytes = await file.readFile();
      if (stamp(await file.stat()) !== entry.stamp) throw new Error("Source changed during import. Scan the folder again.");
      return { path: entry.path.split(path.sep).join("/"), originPath: target, kind: preview.public.kind, bytes };
    } finally { await file.close(); }
  }
}

export function localImportRoutes(repo: LitAgentRepository, manuscripts: ManuscriptStore, indexPaper: (id: string) => void): Router {
  const router = Router(), folders = new LocalFolderImports();
  let importing = false;
  router.use(requireLocalAccess);
  router.post("/preview", async (req, res) => {
    try { res.json(await folders.preview(req.body)); }
    catch { res.status(400).json({ error: "Could not scan that folder. Use a readable absolute folder on the LitAgent server and retry." }); }
  });
  router.post("/entry", async (req, res) => {
    if (importing) { res.status(409).json({ error: "Another local file is importing. Retry this file shortly." }); return; }
    importing = true;
    try {
      const input = ImportLocalEntrySchema.parse(req.body);
      if (input.manuscriptId) manuscripts.read(input.manuscriptId);
      if (input.projectId && !repo.readProject(input.projectId)) throw new Error("Project not found.");
      const file = await folders.read(input.previewId, input.entryId);
      if (file.kind === "sources") {
        if (!input.manuscriptId) throw new Error("Choose a writing document first.");
        const content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
        if (content.includes("\0")) throw new Error("Binary files cannot be attached as text.");
        const kind: WritingAttachmentInput["kind"] = input.sourceKind ?? (/\.(csv|tsv|json)$/i.test(file.path) ? "results" : /\.(md|txt|tex|bib)$/i.test(file.path) ? "notes" : "code");
        const source = manuscripts.attachWritingSource(input.manuscriptId, { path: file.path, content, kind, originPath: file.originPath, originUrl: input.originUrl ?? null });
        res.status(201).json({ source });
      } else {
        if (!file.bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("File is not a PDF.");
        const directory = repo.resolve(".litagent/cache/imports"); await fs.mkdir(directory, { recursive: true });
        const temporaryDirectory = await fs.mkdtemp(path.join(directory, "pdf-"));
        const temporary = path.join(temporaryDirectory, path.basename(file.path));
        let result;
        try {
          await fs.writeFile(temporary, file.bytes, { flag: "wx", mode: 0o600 });
          result = repo.importPaper({ sourcePath: temporary, projectId: input.projectId ?? null });
        } finally { await fs.rm(temporaryDirectory, { force: true, recursive: true }); }
        indexPaper(result.paper.id); res.status(201).json(result);
      }
    } catch (error) { res.status(400).json({ error: error instanceof Error && !("issues" in error) ? error.message : "Invalid import selection." }); }
    finally { importing = false; }
  });
  return router;
}
