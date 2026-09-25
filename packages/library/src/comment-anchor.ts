import type { CommentAnchor, CommentLocationSchema, ManuscriptFile } from "@litagent/contracts";
import type { z } from "zod";

/** Only exact, contextual matches can move an anchor. Ambiguity stays visible. */
export function locateComment(anchor: CommentAnchor, file?: ManuscriptFile): z.infer<typeof CommentLocationSchema> {
  const unavailable = { path: anchor.path, revision: file?.revision ?? null, from: null, to: null, line: null };
  if (!file) return { ...unavailable, state: "missing" };
  const located = (from: number, state: "attached" | "moved") => ({ ...unavailable, state, from, to: from + anchor.quote.length, line: file.content.slice(0, from).split("\n").length });
  if (file.revision === anchor.revision && file.content.slice(anchor.from, anchor.to) === anchor.quote) return located(anchor.from, "attached");
  const candidates: number[] = [];
  let offset = 0;
  while (offset <= file.content.length) {
    const from = file.content.indexOf(anchor.quote, offset);
    if (from < 0) break;
    const to = from + anchor.quote.length;
    // Both contexts must match, including document boundaries; never pick the
    // first occurrence of a duplicated phrase after the original was removed.
    const before = anchor.prefix ? file.content.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix : from === 0;
    const after = anchor.suffix ? file.content.slice(to, to + anchor.suffix.length) === anchor.suffix : to === file.content.length;
    if (before && after) candidates.push(from);
    if (candidates.length > 1) break;
    offset = from + 1;
  }
  return candidates.length === 1 ? located(candidates[0]!, "moved") : { ...unavailable, state: "outdated" };
}
