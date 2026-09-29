import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { PaperFolderRequestSchema, ImportPaperFolderEntrySchema, PaperSchema, type PaperFolderPreview, type PaperLocalSourceState, type Paper } from "@litagent/contracts";
import { parseMarkdownPassages, type LitAgentRepository } from "./index";
import {
  PaperFileRefSchema, LocalPaperError, paperRoot, paperSourcePath, readPaperSource, paperFileHash, paperFileStamp,
  paperFileLimits, excludedPaperEntry, decodePaperMarkdown, paperImageReferences, paperAssetKey, paperAssetReference,
  atomicPaperFile, type PaperFileRef, type PaperRoot,
} from "./paper-source-files";

export { LocalPaperError } from "./paper-source-files";
const BindingSchema = z.object({ pdf: PaperFileRefSchema.nullable(), markdown: PaperFileRefSchema.nullable() });
type Binding = z.infer<typeof BindingSchema>;
type File = PaperFolderPreview["markdownFiles"][number];
type Grant = { ref: PaperFileRef; stamp: string };
type Preview = { view: PaperFolderPreview; grants: Map<string, Grant> };
type Snapshot = { state: PaperLocalSourceState; markdown: string | null; binding: Binding | null; assets: Map<string, PaperFileRef>; signature: string };
const nameKey = (name: string) => name.normalize("NFC").toLocaleLowerCase("en-US");
const stem = (name: string) => name.replace(/\.(pdf|md|markdown)$/i, "");
function matchKey(name: string): string {
  const parts = stem(name).split("/").filter((part) => !/^(pdfs?|markdown|md)$/i.test(part));
  if (parts.length > 1 && (nameKey(parts.at(-1)!) === nameKey(parts.at(-2)!) || /^(paper|document|index)$/i.test(parts.at(-1)!))) parts.pop();
  return nameKey(parts.join("/"));
}
const fileTitle = (name: string) => stem(path.posix.basename(name));

export class LocalPaperImports {
  private readonly previews = new Map<string, Preview>();
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(private readonly repo: LitAgentRepository) {}

  preview(input: unknown): PaperFolderPreview {
    const request = PaperFolderRequestSchema.parse(input);
    let pdfRoot = paperRoot(request.path), markdownRoot = request.markdownPath ? paperRoot(request.markdownPath) : pdfRoot;
    if (!request.markdownPath) {
      for (const prefix of ["literature", ""]) {
        if (fs.existsSync(path.join(pdfRoot.path, prefix, "pdf")) && fs.existsSync(path.join(pdfRoot.path, prefix, "markdown"))) {
          markdownRoot = paperRoot(path.join(pdfRoot.path, prefix, "markdown"));
          pdfRoot = paperRoot(path.join(pdfRoot.path, prefix, "pdf")); break;
        }
      }
      if (markdownRoot.path === pdfRoot.path && /^(pdf|markdown)$/i.test(path.basename(pdfRoot.path))) {
        const sibling = path.join(path.dirname(pdfRoot.path), path.basename(pdfRoot.path).toLowerCase() === "pdf" ? "markdown" : "pdf");
        if (fs.existsSync(sibling)) {
          if (path.basename(pdfRoot.path).toLowerCase() === "pdf") markdownRoot = paperRoot(sibling);
          else { markdownRoot = pdfRoot; pdfRoot = paperRoot(sibling); }
        }
      }
    }
    for (const root of [pdfRoot, markdownRoot]) {
      if (root.path === this.repo.root || root.path.startsWith(this.repo.root + path.sep) || this.repo.root.startsWith(root.path + path.sep)) {
        throw new LocalPaperError(400, "Choose source folders outside the LitAgent research repository.");
      }
    }
    const view: PaperFolderPreview = { id: randomUUID(), root: pdfRoot.path, markdownRoot: markdownRoot.path, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), entries: [], markdownFiles: [], skipped: 0, truncated: false };
    const grants = new Map<string, Grant>(), pdfs: File[] = [], markdown: File[] = [];
    let visited = 0;
    const scan = (root: PaperRoot, relative = "", mode: "pdf" | "markdown" | "both" = "both") => {
      const directory = path.join(root.path, relative);
      if (fs.realpathSync(directory) !== directory) throw new LocalPaperError(409, "A folder changed during preview. Scan again.");
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (++visited > 30_000 || pdfs.length + markdown.length >= 4000) { view.truncated = true; break; }
        if (entry.isSymbolicLink() || excludedPaperEntry(entry.name)) { view.skipped++; continue; }
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { if (name.split("/").length < 24) scan(root, name, mode); else view.skipped++; continue; }
        const pdf = /\.pdf$/i.test(name), md = /\.(md|markdown)$/i.test(name);
        if (!entry.isFile() || (!pdf && !md) || (mode === "pdf" && !pdf) || (mode === "markdown" && !md)) { view.skipped++; continue; }
        const ref = { root, path: name }, stat = fs.statSync(paperSourcePath(ref));
        if (!stat.size || stat.size > (pdf ? paperFileLimits.pdf : paperFileLimits.markdown)) { view.skipped++; continue; }
        const file = { id: randomUUID(), path: name, bytes: stat.size };
        grants.set(file.id, { ref, stamp: paperFileStamp(stat) }); (pdf ? pdfs : markdown).push(file);
      }
    };
    if (pdfRoot.path === markdownRoot.path) scan(pdfRoot);
    else { scan(pdfRoot, "", "pdf"); scan(markdownRoot, "", "markdown"); }
    pdfs.sort((a, b) => a.path.localeCompare(b.path)); markdown.sort((a, b) => a.path.localeCompare(b.path));
    const used = new Set<string>();
    for (const pdf of pdfs) {
      const exact = markdown.filter((md) => matchKey(md.path) === matchKey(pdf.path));
      const names = markdown.filter((md) => nameKey(path.posix.basename(matchKey(md.path))) === nameKey(fileTitle(pdf.path)));
      const matches = exact.length ? exact : names;
      const uniquePdf = pdfs.filter((other) => exact.length ? matchKey(other.path) === matchKey(pdf.path) : nameKey(fileTitle(other.path)) === nameKey(fileTitle(pdf.path))).length === 1;
      const md = matches.length === 1 && uniquePdf && !used.has(matches[0]!.id) ? matches[0]! : null;
      if (md) used.add(md.id);
      view.entries.push({ id: randomUUID(), title: fileTitle(pdf.path), pdf, markdown: md, match: md ? exact.length ? "path" : "name" : null });
    }
    for (const md of markdown) if (!used.has(md.id)) view.entries.push({ id: randomUUID(), title: fileTitle(md.path), pdf: null, markdown: md, match: null });
    view.markdownFiles = markdown;
    for (const [id, item] of this.previews) if (Date.parse(item.view.expiresAt) < Date.now()) this.previews.delete(id);
    while (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(view.id, { view, grants });
    return view;
  }

  importEntry(input: unknown): { paper: Paper; warnings: string[] } {
    const request = ImportPaperFolderEntrySchema.parse(input), preview = this.previews.get(request.previewId);
    const entry = preview?.view.entries.find((item) => item.id === request.entryId);
    if (!preview || !entry || Date.parse(preview.view.expiresAt) < Date.now()) throw new LocalPaperError(409, "Folder preview expired. Scan again before importing.");
    if (request.projectId && !this.repo.readProject(request.projectId)) throw new LocalPaperError(404, "Project not found.");
    const markdownId = request.markdownId === undefined ? entry.markdown?.id : request.markdownId;
    if (markdownId && !preview.view.markdownFiles.some((file) => file.id === markdownId)) throw new LocalPaperError(400, "Select a Markdown file from this preview.");
    const pdf = entry.pdf ? preview.grants.get(entry.pdf.id)! : null, md = markdownId ? preview.grants.get(markdownId)! : null;
    if (!pdf && !md) throw new LocalPaperError(400, "Select a PDF or Markdown file.");
    const pdfBytes = pdf ? readPaperSource(pdf.ref, paperFileLimits.pdf, pdf.stamp).bytes : null;
    if (pdfBytes && !pdfBytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new LocalPaperError(400, "Selected file is not a PDF.");
    const markdown = md ? decodePaperMarkdown(readPaperSource(md.ref, paperFileLimits.markdown, md.stamp).bytes) : null;
    const binding: Binding = { pdf: pdf?.ref ?? null, markdown: md?.ref ?? null };
    const warnings: string[] = [], assets = new Map<string, Buffer>();
    let total = 0;
    if (md && markdown !== null) for (const key of paperImageReferences(markdown)) {
      if (assets.size >= 512) throw new LocalPaperError(413, "A paper exceeds the 512-image limit.");
      try {
        const image = readPaperSource(paperAssetReference(md.ref, key), paperFileLimits.image).bytes;
        total += image.length;
        if (total > paperFileLimits.assets) throw new LocalPaperError(413, "Paper images exceed 128 MB.");
        assets.set(key, image);
      } catch (error) {
        if (error instanceof LocalPaperError && error.status === 413) throw error;
        warnings.push(`Image unavailable or outside the selected folder: ${key}`);
      }
    }
    let id = `paper_${createHash("sha1").update(`${pdfBytes ? "sha256:" : "markdown:"}${paperFileHash(pdfBytes ?? markdown!)}`).digest("hex").slice(0, 16)}`;
    const sameFiles = (candidate: Binding) => JSON.stringify(candidate) === JSON.stringify(binding);
    for (const candidate of this.repo.listGlobalPapers().filter((paper) => paper.storage === "linked-files")) {
      try { if (sameFiles(this.binding(candidate.id))) { id = candidate.id; break; } } catch { /* Missing machine-local links do not block other imports. */ }
    }
    const existing = this.repo.readPaper(id);
    if (existing?.storage === "linked-files" && (request.storage !== "linked-files" || !sameFiles(this.binding(id)))) throw new LocalPaperError(409, "This paper is attached to different local files. Its existing link was preserved.");
    if (existing && !existing.storage && markdown !== null && this.repo.readMarkdown(id) !== null && this.repo.readMarkdown(id) !== markdown) {
      throw new LocalPaperError(409, "This paper already has different Markdown. Its current reading copy was preserved.");
    }
    const paperDirectory = this.repo.resolve(`library/papers/${id}`), markdownDirectory = this.repo.resolve(`library/markdown/${id}`);
    const timestamp = new Date().toISOString();
    const paper = PaperSchema.parse({
      ...existing, id, title: existing?.title ?? entry.title, authors: existing?.authors ?? [], tags: existing?.tags ?? [],
      ...(request.storage === "linked-files" ? { storage: "linked-files" } : {}),
      filePaths: { pdf: pdf ? `library/papers/${id}/paper.pdf` : existing?.filePaths.pdf ?? null,
        markdown: md ? `library/markdown/${id}/paper.md` : existing?.filePaths.markdown ?? null,
        assets: md ? `library/markdown/${id}/assets` : existing?.filePaths.assets ?? null },
      createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp,
    });
    // All selected source bytes are validated before publishing metadata. No original is written.
    if (request.storage === "linked-files") {
      if (existing && !existing.storage && (Boolean(existing.filePaths.pdf) !== Boolean(pdf) || Boolean(existing.filePaths.markdown) !== Boolean(md))) {
        throw new LocalPaperError(409, "Attach both existing formats to preserve this paper's PDF and Markdown.");
      }
      atomicPaperFile(this.bindingPath(id), JSON.stringify(binding));
    } else {
      if (pdfBytes && !existing?.filePaths.pdf) atomicPaperFile(path.join(paperDirectory, "paper.pdf"), pdfBytes);
      if (markdown !== null && !existing?.filePaths.markdown) {
        const assetMap: Record<string, string> = {};
        for (const [key, bytes] of assets) {
          const filename = `${paperFileHash(bytes)}${path.extname(key).toLowerCase()}`;
          atomicPaperFile(path.join(markdownDirectory, "assets", filename), bytes); assetMap[key] = filename;
        }
        atomicPaperFile(path.join(markdownDirectory, "import-assets.json"), JSON.stringify(assetMap));
        atomicPaperFile(path.join(markdownDirectory, "paper.md"), markdown);
      }
    }
    atomicPaperFile(path.join(paperDirectory, "metadata.json"), JSON.stringify(paper, null, 2));
    if (request.storage === "linked-files") { this.snapshots.delete(id); this.refresh(id); }
    else if (markdown !== null) this.repo.writePassages(id, parseMarkdownPassages(id, markdown));
    if (request.projectId) this.repo.linkPaperToProject(id, { projectId: request.projectId });
    return { paper: this.repo.readPaper(id)!, warnings };
  }

  private bindingPath(id: string): string {
    if (!/^paper_[a-f0-9]{16}$/.test(id)) throw new LocalPaperError(400, "Invalid linked paper ID.");
    return this.repo.resolve(`.litagent/paper-links/${id}.json`);
  }
  private binding(id: string): Binding {
    try { return BindingSchema.parse(JSON.parse(fs.readFileSync(this.bindingPath(id), "utf8"))); }
    catch { throw new LocalPaperError(409, "This paper's local file link is unavailable on this server. No source copy is stored in LitAgent."); }
  }

  refresh(id: string): Snapshot {
    const paper = this.repo.readPaper(id);
    if (!paper?.storage) throw new LocalPaperError(400, "This paper does not use linked files.");
    let binding: Binding | null = null;
    try {
      binding = this.binding(id);
      const pdfStamp = binding.pdf ? paperFileStamp(fs.statSync(paperSourcePath(binding.pdf))) : null;
      const mdStamp = binding.markdown ? paperFileStamp(fs.statSync(paperSourcePath(binding.markdown))) : null;
      const previous = this.snapshots.get(id), signature = JSON.stringify([binding, pdfStamp, mdStamp]);
      if (binding.pdf && fs.statSync(paperSourcePath(binding.pdf)).size > paperFileLimits.pdf) throw new LocalPaperError(413, "The linked PDF exceeds 200 MB.");
      const markdown = signature === previous?.signature ? previous.markdown : binding.markdown ? decodePaperMarkdown(readPaperSource(binding.markdown, paperFileLimits.markdown).bytes) : null;
      const assets = signature === previous?.signature ? previous.assets : new Map<string, PaperFileRef>();
      const imageKeys = signature !== previous?.signature && markdown !== null ? paperImageReferences(markdown) : [];
      if (imageKeys.length > 512) throw new LocalPaperError(413, "The linked Markdown exceeds 512 images.");
      if (binding.markdown) for (const key of imageKeys) {
        try { assets.set(key, paperAssetReference(binding.markdown, key)); } catch { /* Missing images remain unavailable; never read outside the granted roots. */ }
      }
      const assetStamps = [...assets].map(([key, ref]) => { try { return [key, paperFileStamp(fs.statSync(paperSourcePath(ref)))]; } catch { return [key, null]; } });
      const state: PaperLocalSourceState = { available: true, revision: paperFileHash(JSON.stringify([signature, assetStamps])), pdfRevision: pdfStamp ? paperFileHash(pdfStamp) : null, pdf: binding.pdf?.path ?? null, markdown: binding.markdown?.path ?? null, message: null };
      if (!previous || previous.markdown !== markdown || !previous.state.available) this.repo.writePassages(id, markdown === null ? [] : parseMarkdownPassages(id, markdown));
      this.publishRevision(paper, state);
      const next = { binding, markdown, assets, state, signature }; this.cache(id, next); return next;
    } catch (error) {
      const state: PaperLocalSourceState = { available: false, revision: "unavailable", pdfRevision: null, pdf: binding?.pdf?.path ?? null, markdown: binding?.markdown?.path ?? null, message: error instanceof LocalPaperError ? error.message : "Local sources could not be read. Check their paths and permissions, then refresh." };
      const next: Snapshot = { state, markdown: null, binding, assets: new Map(), signature: "unavailable" };
      this.cache(id, next); this.publishRevision(paper, state); return next;
    }
  }
  private cache(id: string, snapshot: Snapshot) {
    this.snapshots.delete(id);
    while (this.snapshots.size >= 32) this.snapshots.delete(this.snapshots.keys().next().value!);
    this.snapshots.set(id, snapshot);
  }
  private publishRevision(paper: Paper, state: PaperLocalSourceState) {
    const pdfRevision = state.pdfRevision ?? (state.available ? "none" : "unavailable");
    if (paper.sourceRevision === state.revision && paper.pdfRevision === pdfRevision) return;
    atomicPaperFile(this.repo.resolve(`library/papers/${paper.id}/metadata.json`), JSON.stringify({ ...paper, sourceRevision: state.revision, pdfRevision, updatedAt: new Date().toISOString() }, null, 2));
  }
  pdfPath(id: string): string | null {
    const snapshot = this.refresh(id);
    return snapshot.state.available && snapshot.binding?.pdf ? paperSourcePath(snapshot.binding.pdf) : null;
  }
  asset(id: string, url: string): Buffer | null {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
    const key = paperAssetKey(url); if (!key) return null;
    if (this.repo.readPaper(id)?.storage) {
      const snapshot = this.refresh(id), ref = snapshot.assets.get(key);
      if (!snapshot.state.available || !ref) return null;
      try { return readPaperSource(ref, paperFileLimits.image).bytes; } catch { return null; }
    }
    const directory = this.repo.resolve(`library/markdown/${id}`), manifest = path.join(directory, "import-assets.json");
    if (fs.existsSync(manifest)) {
      const mapping = z.record(z.string(), z.string()).parse(JSON.parse(fs.readFileSync(manifest, "utf8")));
      const filename = mapping[key];
      if (!filename || !/^[a-f0-9]{64}\.[a-z0-9]+$/.test(filename)) return null;
      try { return fs.readFileSync(path.join(directory, "assets", filename)); } catch { return null; }
    }
    const relative = key.replace(/^assets\//, ""), root = path.join(directory, "assets"), target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) return null;
    try { if (fs.realpathSync(target) !== target || !fs.statSync(target).isFile()) return null; return fs.readFileSync(target); } catch { return null; }
  }
}
