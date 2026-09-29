import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ManuscriptNodePathSchema, type ManuscriptFile, type ManuscriptDocument, type ManuscriptFolderPreview } from "@litagent/contracts";
import { manuscriptLimits, skippedImportPath, sourceKind, sourceRevision, validateTreePaths } from "./manuscript-files";
import { describeManuscriptSources } from "./manuscript-import";
import { ManuscriptError } from "./manuscript-error";

export const FolderLinkSchema = z.object({ path: z.string(), device: z.number(), inode: z.number() });
export type FolderLink = z.infer<typeof FolderLinkSchema>;
const unavailable = () => new ManuscriptError(409, "linked_folder_unavailable", "Linked folder is unavailable or has been replaced. Restore it at its original path, then retry. Your unsaved text is retained.");
const excludedDirectory = /^(node_modules|vendor|dist|build|out|target|__pycache__|venv|env|coverage)$/i;

export function folderIdentity(input: string): FolderLink {
  if (!path.isAbsolute(input)) throw new ManuscriptError(400, "invalid_folder", "Enter an absolute folder path on the LitAgent server.");
  const root = path.resolve(input);
  if (root === path.parse(root).root || root === os.homedir() || root.split(path.sep).some((part) => part.startsWith("."))) {
    throw new ManuscriptError(400, "invalid_folder", "Choose a document folder, not your home, filesystem root or a hidden configuration folder.");
  }
  try {
    if (fs.realpathSync(root) !== root) throw unavailable();
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory()) throw unavailable();
    return { path: root, device: stat.dev, inode: stat.ino };
  } catch { throw unavailable(); }
}

/** Validate the saved directory identity and every descendant; never follow symlinks. */
export function linkedPath(link: FolderLink, relative = "", createParents = false): string {
  const current = folderIdentity(link.path);
  if (current.device !== link.device || current.inode !== link.inode) throw unavailable();
  if (!relative) return current.path;
  ManuscriptNodePathSchema.parse(relative);
  const parts = relative.split("/");
  if (skippedImportPath(relative) || parts.slice(0, -1).some((part) => excludedDirectory.test(part))) throw new ManuscriptError(400, "excluded_linked_path", "Build and dependency paths are excluded from linked documents.");
  let target = current.path;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    let stat: fs.Stats | undefined;
    try { stat = fs.lstatSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (stat && (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isDirectory() && !stat.isFile()))) {
      throw new ManuscriptError(409, "unsafe_linked_path", "Linked files cannot use symlinks or special files. No file was overwritten.");
    }
    if (!stat && createParents && index < parts.length - 1) fs.mkdirSync(target);
  }
  return target;
}

export function scanManuscriptFolder(link: FolderLink) {
  const files: ManuscriptFile[] = [], assets: NonNullable<ManuscriptDocument["assets"]> = [];
  const preview: ManuscriptFolderPreview = { folderPath: link.path, revision: "", files: [], folders: [], entryCandidates: [], suggestedEntry: null, rootFolder: path.basename(link.path), skipped: [], warnings: [], requirements: [] };
  const contents = new Map<string, Buffer>();
  let visited = 0, total = 0, textTotal = 0;
  const walk = (prefix: string) => {
    const directory = linkedPath(link, prefix);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 4096) throw new ManuscriptError(413, "manuscript_limit", "Folder exceeds the 4096-entry scan limit.");
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const skip = skippedImportPath(relative) ?? (entry.isSymbolicLink() ? "Symbolic link" : entry.isDirectory() && excludedDirectory.test(entry.name) ? "Build or dependency folder" : null);
      if (skip) { preview.skipped.push({ path: relative, reason: skip }); continue; }
      if (!ManuscriptNodePathSchema.safeParse(relative).success) { preview.skipped.push({ path: relative, reason: "Unsupported filename or folder depth" }); continue; }
      if (entry.isDirectory()) {
        preview.folders.push(relative);
        if (preview.folders.length > manuscriptLimits.folders) throw new ManuscriptError(413, "manuscript_limit", "Folder exceeds 256 subfolders.");
        walk(relative); continue;
      }
      const kind = sourceKind(relative);
      if (!kind || !entry.isFile() || relative === "manuscript.json") { preview.skipped.push({ path: relative, reason: "Unsupported or reserved file" }); continue; }
      if (/\.pdf$/i.test(relative) && fs.existsSync(path.join(directory, `${entry.name.slice(0, -4)}.tex`))) { preview.skipped.push({ path: relative, reason: "Compiled PDF (source retained)" }); continue; }
      const fd = fs.openSync(linkedPath(link, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(fd);
        total += stat.size; if (kind === "source") textTotal += stat.size;
        if (!stat.isFile() || stat.size > (kind === "source" ? manuscriptLimits.textFile : manuscriptLimits.asset) || total > manuscriptLimits.total || textTotal > manuscriptLimits.textTotal || files.length + assets.length >= manuscriptLimits.files) {
          throw new ManuscriptError(413, "manuscript_limit", "Linked folder exceeds the document limit (256 files, 1 MB text file, 16 MB asset, 8 MB text, 64 MB total).");
        }
        // A bounded descriptor read rejects files that grow during the scan.
        const data = Buffer.alloc(stat.size + 1);
        let size = 0, read = 0;
        do { read = fs.readSync(fd, data, size, data.length - size, size); size += read; } while (read && size < data.length);
        const after = fs.fstatSync(fd);
        if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new ManuscriptError(409, "linked_file_changed", "A linked file changed while reading. Retry after the external save finishes.");
        const bytes = data.subarray(0, size);
        const revision = sourceRevision(bytes);
        if (kind === "source") {
          let content: string;
          try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); if (content.includes("\0")) throw new Error(); }
          catch { throw new ManuscriptError(400, "invalid_text", `Source is not UTF-8 text: ${relative}`); }
          files.push({ path: relative, content, revision }); contents.set(relative, bytes);
          if (/\.tex$/i.test(relative)) preview.entryCandidates.push(relative);
        } else assets.push({ path: relative, revision, bytes: size });
        preview.files.push({ path: relative, kind, bytes: size });
      } finally { fs.closeSync(fd); }
    }
  };
  try { walk(""); linkedPath(link); }
  catch (error) {
    if (error instanceof ManuscriptError) throw error;
    throw new ManuscriptError(409, "linked_folder_unreadable", "Could not read the linked folder. Check its permissions and retry; no files were changed.");
  }
  files.sort((a, b) => a.path.localeCompare(b.path)); assets.sort((a, b) => a.path.localeCompare(b.path));
  preview.folders = validateTreePaths([...files, ...assets].map((file) => file.path), preview.folders);
  describeManuscriptSources({ preview, contents });
  preview.revision = sourceRevision(JSON.stringify({ link, files: [...files, ...assets].map(({ path, revision }) => [path, revision]), folders: preview.folders }));
  return { files, assets, folders: preview.folders, preview };
}
