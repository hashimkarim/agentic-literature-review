import { crc32 } from "node:zlib";
import { fromBufferPromise, type Entry } from "yauzl";
import { ManuscriptNodePathSchema, type ManuscriptImportPreview } from "@litagent/contracts";
import { manuscriptLimits, skippedImportPath, sourceKind, validateTreePaths } from "./manuscript-files";

export interface ManuscriptImportData { preview: ManuscriptImportPreview; contents: Map<string, Buffer> }

// Inspect central-directory metadata before decoding any content. Never extract
// archive names onto disk; publication is the store's separate atomic operation.
export async function inspectManuscriptZip(bytes: Buffer): Promise<ManuscriptImportData> {
  if (bytes.length > manuscriptLimits.archive) throw new Error("ZIP exceeds 128 MB.");
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const entries: Entry[] = [];
  const seen = new Set<string>();
  try {
    if (zip.entryCount > 4096) throw new Error("ZIP contains too many entries (maximum 4096).");
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName.replace(/\/$/, "");
      if (name.length > 360 || name.includes("\0") || name.includes("\\") || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe ZIP path.");
      const key = name.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new Error(`Duplicate ZIP path: ${name}`);
      seen.add(key);
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error(`Links and special files are not allowed: ${name}`);
      if (entry.isEncrypted()) throw new Error("Encrypted ZIP files are not supported.");
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error("Unsupported ZIP compression method.");
      entries.push(entry);
    }
    const visible = entries.filter((entry) => !skippedImportPath(entry.fileName));
    const first = visible[0]?.fileName.split("/")[0];
    const rootFolder = first && visible.every((entry) => entry.fileName.startsWith(`${first}/`)) ? first : null;
    const normalize = (name: string) => rootFolder ? name.slice(rootFolder.length + 1) : name;
    const preview: ManuscriptImportPreview = { files: [], folders: [], entryCandidates: [], suggestedEntry: null, rootFolder, skipped: [], warnings: [] };
    const contents = new Map<string, Buffer>();
    const texPaths = new Set(visible.map((entry) => normalize(entry.fileName)).filter((name) => /\.tex$/i.test(name)).map((name) => name.slice(0, -4).toLowerCase()));
    let total = 0, textTotal = 0;
    for (const entry of entries) {
      const relative = normalize(entry.fileName).replace(/\/$/, "");
      const skip = skippedImportPath(entry.fileName) ?? (/\.pdf$/i.test(relative) && texPaths.has(relative.slice(0, -4).toLowerCase()) ? "Compiled PDF (source retained)" : null);
      if (skip) { preview.skipped.push({ path: entry.fileName, reason: skip }); continue; }
      if (!relative) continue;
      if (entry.fileName.endsWith("/")) { ManuscriptNodePathSchema.parse(relative); preview.folders.push(relative); continue; }
      const kind = sourceKind(relative);
      if (!kind) { preview.skipped.push({ path: entry.fileName, reason: "Unsupported file type or filename" }); continue; }
      total += entry.uncompressedSize;
      if (kind === "source") textTotal += entry.uncompressedSize;
      if (entry.uncompressedSize > (kind === "source" ? manuscriptLimits.textFile : manuscriptLimits.asset) || total > manuscriptLimits.total || textTotal > manuscriptLimits.textTotal) throw new Error("Import exceeds the file or document size limit (1 MB text, 16 MB asset, 8 MB total text, 64 MB document).");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > entry.uncompressedSize) throw new Error("ZIP expanded beyond its declared size.");
          chunks.push(Buffer.from(chunk));
        }
      } finally { stream.destroy(); }
      const data = Buffer.concat(chunks);
      if (size !== entry.uncompressedSize || crc32(data) !== entry.crc32) throw new Error(`ZIP integrity check failed: ${relative}`);
      if (kind === "source") {
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
        if (content.includes("\0")) throw new Error(`Text source contains binary data: ${relative}`);
        if (/\.tex$/i.test(relative)) preview.entryCandidates.push(relative);
      }
      contents.set(relative, data); preview.files.push({ path: relative, kind, bytes: size });
    }
    preview.folders = validateTreePaths([...contents.keys()], preview.folders);
    if (!preview.entryCandidates.length) throw new Error("No supported .tex files were found.");
    const roots = preview.entryCandidates.filter((name) => /^\s*\\documentclass(?:\[|\{)/m.test(contents.get(name)!.toString("utf8")));
    preview.suggestedEntry = roots.includes("main.tex") ? "main.tex" : roots.length === 1 ? roots[0]! : preview.entryCandidates.length === 1 ? preview.entryCandidates[0]! : null;
    const text = preview.files.filter((file) => file.kind === "source").map((file) => contents.get(file.path)!.toString("utf8")).join("\n");
    if (/backend\s*=\s*biber/.test(text)) preview.warnings.push("Biber is required by these sources; the current offline compiler does not run Biber.");
    if (/\\makeglossaries/.test(text)) preview.warnings.push("Glossary generation requires an external build step that is not bundled yet.");
    if (/\\(?:setmainfont|setsansfont|setmonofont|newfontfamily)/.test(text)) preview.warnings.push("Custom font dependencies may be unavailable in the isolated compiler.");
    if (preview.files.some((file) => /(?:latexmkrc|\.(?:py|sh))$/.test(file.path))) preview.warnings.push("Build scripts are preserved as editable text but are never executed by the compiler.");
    preview.files.sort((a, b) => a.path.localeCompare(b.path)); preview.entryCandidates.sort();
    return { preview, contents };
  } finally { zip.close(); }
}
