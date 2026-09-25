import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parser } from "@inkylabs/synctex-js";
import { TexSourceBoxSchema, type ManuscriptDocument, type TexSourceBox, type PdfCommentSelection, type CommentSelection } from "@litagent/contracts";
import { ManuscriptError } from "@litagent/library";

export async function readSyncTex(file: string): Promise<Buffer | undefined> {
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return undefined;
    return await fs.promises.readFile(file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export function sourceBoxes(compressed: Buffer, document: ManuscriptDocument): TexSourceBox[] {
  const text = gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8");
  // This parser supports standard engine units, not post-processed scaling.
  if (!text.startsWith("SyncTeX Version:1\n") || !/^Unit:1$/m.test(text) || !/^Magnification:1000$/m.test(text) || !/^X Offset:\d+$/m.test(text) || !/^Y Offset:\d+$/m.test(text) || /^(?:Magnification|X Offset|Y Offset):/m.test(text.split("Post scriptum:")[1] ?? "")) throw new Error("Unsupported SyncTeX units.");
  const files = new Map(document.files.map((file) => [file.path, file.content.split("\n").length]));
  const boxes: TexSourceBox[] = [];
  const seen = new Set<string>();
  const parsedMap = parser.parseSyncTex(text);
  for (const block of parsedMap.hBlocks) {
    if (block.width <= 0 || block.height <= 0) continue;
    // Text inside an included chapter can be boxed by its caller. Prefer its
    // inner records, excluding the caller's trailing glue at the right edge.
    const elements = block.elements.filter((element) => element.left < block.left + block.width - 0.5);
    for (const owner of elements.length ? elements : [block]) {
      const input = owner.file?.path;
      if (!input) continue;
      const relative = path.posix.normalize(input.startsWith("/work/") ? input.slice(6) : input);
      const lines = files.get(relative);
      if (!lines || owner.line > lines) continue;
      const parsed = TexSourceBoxSchema.safeParse({ path: relative, line: owner.line, page: block.page,
        x: block.left + parsedMap.offset.x, y: block.bottom - block.height + parsedMap.offset.y, width: block.width, height: block.height });
      if (!parsed.success) continue;
      const identity = JSON.stringify(parsed.data);
      if (!seen.has(identity)) { seen.add(identity); boxes.push(parsed.data); }
      if (boxes.length > 100000) throw new Error("SyncTeX map exceeds the box limit.");
    }
  }
  return boxes;
}

function overlap(a: PdfCommentSelection["rects"][number], b: TexSourceBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

export function sourceSelection(boxes: TexSourceBox[], selection: PdfCommentSelection, document: ManuscriptDocument): CommentSelection {
  const hits = boxes.filter((box) => box.page === selection.page && selection.rects.some((rect) => overlap(rect, box) > 0));
  const paths = new Set(hits.map((box) => box.path));
  if (paths.size !== 1) throw new ManuscriptError(422, "pdf_source_ambiguous", "Select text from one source paragraph. This PDF selection has no unique TeX location.");
  const file = document.files.find((file) => file.path === hits[0]!.path)!;
  const lines = file.content.split("\n");
  let first = Math.min(...hits.map((box) => box.line)) - 1;
  const last = Math.max(...hits.map((box) => box.line)) - 1;
  // TeX often attributes every rendered line of a paragraph to its final source
  // line. Include that paragraph, then narrow to the selected literal text.
  while (first > 0 && lines[first - 1]!.trim() && !/^\s*\\(?:begin|end|(?:sub)*section|chapter)\b/.test(lines[first - 1]!)) first--;
  const from = lines.slice(0, first).reduce((sum, line) => sum + line.length + 1, 0);
  const to = lines.slice(0, last + 1).reduce((sum, line) => sum + line.length + 1, 0) - 1;
  const paragraph = file.content.slice(from, to);
  if (!paragraph.trim() || paragraph.length > 8000) throw new ManuscriptError(422, "pdf_source_too_large", "Select a shorter source paragraph for this comment.");
  // Ignore PDF line wraps and discretionary hyphens, but never TeX commands or
  // arbitrary characters. Unmatched math/macros keep a visibly reviewable source range.
  const normalize = (value: string) => value.normalize("NFKC").replace(/\u00ad/g, "").replace(/-\s*\n\s*/g, "").replace(/\s+/g, "");
  let normalized = "";
  const offsets: number[] = [];
  for (let i = 0; i < paragraph.length; i++) for (const char of normalize(paragraph[i]!)) { normalized += char; offsets.push(i); }
  const needle = normalize(selection.quote);
  const index = needle ? normalized.indexOf(needle) : -1;
  if (index >= 0 && normalized.indexOf(needle, index + 1) < 0) {
    const start = from + offsets[index]!, end = from + offsets[index + needle.length - 1]! + 1;
    return { path: file.path, revision: file.revision, from: start, to: end, quote: file.content.slice(start, end) };
  }
  return { path: file.path, revision: file.revision, from, to, quote: paragraph };
}
