import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { fromMarkdown } from "mdast-util-from-markdown";
import { fromHtml } from "hast-util-from-html";
import { normalizeMarkdownImages } from "./markdown-images";

export const paperFileLimits = { pdf: 200_000_000, markdown: 8_000_000, image: 16_000_000, assets: 128_000_000 };
export const paperFileHash = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
export const paperFileStamp = (stat: fs.Stats) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
export class LocalPaperError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const PaperRootSchema = z.object({ path: z.string(), device: z.number(), inode: z.number() });
export const PaperFileRefSchema = z.object({ root: PaperRootSchema, path: z.string() });
export type PaperRoot = z.infer<typeof PaperRootSchema>;
export type PaperFileRef = z.infer<typeof PaperFileRefSchema>;
const excluded = /^(node_modules|vendor|dist|build|out|target|__pycache__|venv|env|coverage|checkpoints|codebases)$/i;
const sensitive = /(^|[-_.])(secrets?|credentials?|passwords?|tokens?|private[-_]?keys?)([-_.]|$)/i;
export const paperImageExtension = /\.(apng|avif|bmp|gif|jpe?g|jfif|pjpeg|pjp|png|svg|tiff?|webp)$/i;
export const excludedPaperEntry = (name: string) => name.startsWith(".") || excluded.test(name) || sensitive.test(name);
const unavailable = () => new LocalPaperError(409, "Local paper files are unavailable or have moved. Restore them at their original paths, then refresh.");

export function paperRoot(input: string): PaperRoot {
  if (!path.isAbsolute(input)) throw new LocalPaperError(400, "Enter an absolute folder path on the LitAgent server.");
  const root = path.resolve(input);
  if (root === path.parse(root).root || root === os.homedir() || root.split(path.sep).some((part) => part.startsWith(".") || sensitive.test(part))) {
    throw new LocalPaperError(400, "Choose a document folder, not your home, filesystem root or private configuration folders.");
  }
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || fs.realpathSync(root) !== root) throw unavailable();
    return { path: root, device: stat.dev, inode: stat.ino };
  } catch { throw unavailable(); }
}

export function paperSourcePath(ref: PaperFileRef): string {
  const root = paperRoot(ref.root.path);
  if (root.device !== ref.root.device || root.inode !== ref.root.inode) throw unavailable();
  const parts = ref.path.split("/");
  if (!ref.path || path.isAbsolute(ref.path) || ref.path.includes("\\") || /[\x00-\x1f]/.test(ref.path) || parts.some((part) => !part || part === ".." || excludedPaperEntry(part))) {
    throw new LocalPaperError(400, "Local source paths must stay inside the selected folder.");
  }
  const target = path.join(root.path, ...parts);
  try {
    if (fs.realpathSync(target) !== target || !fs.lstatSync(target).isFile()) throw unavailable();
  } catch { throw unavailable(); }
  return target;
}

export function readPaperSource(ref: PaperFileRef, limit: number, expectedStamp?: string): { bytes: Buffer; stamp: string } {
  const target = paperSourcePath(ref);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd), stamp = paperFileStamp(stat);
    if (!stat.isFile() || stat.size > limit) throw new LocalPaperError(413, "A source exceeds the supported file size.");
    if (expectedStamp && expectedStamp !== stamp) throw new LocalPaperError(409, "A source changed since preview. Scan the folder again.");
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0, count = 0;
    do { count = fs.readSync(fd, buffer, size, buffer.length - size, size); size += count; } while (count && size < buffer.length);
    if (size !== stat.size || paperFileStamp(fs.fstatSync(fd)) !== stamp || paperFileStamp(fs.statSync(paperSourcePath(ref))) !== stamp) {
      throw new LocalPaperError(409, "A local source changed during reading. Retry after the external save finishes.");
    }
    return { bytes: buffer.subarray(0, size), stamp };
  } finally { fs.closeSync(fd); }
}

export function decodePaperMarkdown(bytes: Buffer): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes("\0")) throw new Error();
    return text;
  } catch { throw new LocalPaperError(400, "Markdown must be UTF-8 text."); }
}

export function paperAssetKey(url: string): string | null {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(url.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (decoded.includes("\\") || /[\x00-\x1f]/.test(decoded) || !paperImageExtension.test(decoded)) return null;
  return path.posix.normalize(decoded);
}

/** Parse actual image nodes, including reference images and Marker HTML, not code samples. */
export function paperImageReferences(markdown: string): string[] {
  const tree = fromMarkdown(normalizeMarkdownImages(markdown)), definitions = new Map<string, string>(), urls: string[] = [];
  type Node = { type: string; children?: Node[]; url?: string; identifier?: string; value?: string; tagName?: string; properties?: Record<string, unknown> };
  function visit(node: Node, callback: (node: Node) => void) { callback(node); for (const child of node.children ?? []) visit(child, callback); }
  visit(tree, (node) => { if (node.type === "definition" && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url); });
  visit(tree, (node) => {
    if (node.type === "image" && node.url) urls.push(node.url);
    if (node.type === "imageReference" && node.identifier && definitions.has(node.identifier)) urls.push(definitions.get(node.identifier)!);
    if (node.type === "html" && node.value) visit(fromHtml(node.value, { fragment: true }), (element) => {
      if (element.type === "element" && element.tagName === "img" && typeof element.properties?.src === "string") urls.push(element.properties.src);
    });
  });
  return [...new Set(urls.map(paperAssetKey).filter((url): url is string => url !== null))];
}

export function paperAssetReference(markdown: PaperFileRef, key: string): PaperFileRef {
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(markdown.path), key));
  if (path.posix.isAbsolute(relative) || relative.split("/").some((part) => part === ".." || excludedPaperEntry(part))) throw new LocalPaperError(400, "Image is outside the selected source folder.");
  const ref = { root: markdown.root, path: relative };
  return ref;
}

export function atomicPaperFile(target: string, bytes: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, target); }
  finally { fs.rmSync(temporary, { force: true }); }
}
