import { createHash } from "node:crypto";
import { ManuscriptAssetPathSchema, ManuscriptNodePathSchema, ManuscriptPathSchema } from "@litagent/contracts";

export const manuscriptLimits = { files: 256, folders: 256, textFile: 1_000_000, textTotal: 8_000_000, asset: 16 * 1024 * 1024, total: 64 * 1024 * 1024, archive: 128 * 1024 * 1024 };
export const sourceRevision = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
export class ManuscriptTreeError extends Error {}
export function sourceKind(name: string): "source" | "asset" | null {
  return ManuscriptPathSchema.safeParse(name).success ? "source" : ManuscriptAssetPathSchema.safeParse(name).success ? "asset" : null;
}
export function skippedImportPath(name: string): string | null {
  if (name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX" || part === "node_modules")) return "Hidden or dependency file";
  if (/\.(aux|log|toc|out|bcf|blg|fls|fdb_latexmk|synctex(?:\.gz)?|run\.xml|acn|acr|alg|glg|glo|gls|ist|lol|lof|lot|xdv)$/i.test(name)) return "Generated build file";
  return null;
}
export function validateTreePaths(files: string[], folders: string[]) {
  const nodes = new Map<string, { name: string; folder: boolean }>();
  const add = (name: string, folder: boolean, implicit = false) => {
    ManuscriptNodePathSchema.parse(name);
    const key = name.normalize("NFC").toLowerCase();
    const old = nodes.get(key);
    if (old && (old.name !== name || old.folder !== folder || (!implicit && !folder))) throw new ManuscriptTreeError(`Conflicting file or folder: ${name}`);
    nodes.set(key, { name, folder });
  };
  for (const folder of folders) add(folder, true);
  for (const file of files) add(file, false);
  for (const name of [...folders, ...files]) {
    const parts = name.split("/");
    while (parts.length > 1) { parts.pop(); add(parts.join("/"), true, true); }
  }
  const allFolders = [...nodes.values()].filter((node) => node.folder).map((node) => node.name).sort();
  if (files.length > manuscriptLimits.files || allFolders.length > manuscriptLimits.folders) throw new ManuscriptTreeError("Document exceeds the 256-file or 256-folder limit.");
  return allFolders;
}
