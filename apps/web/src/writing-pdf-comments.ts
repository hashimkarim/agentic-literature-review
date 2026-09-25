import type { ManuscriptCommentView, ManuscriptFile, TexBuild, TexSourceBox } from "@litagent/contracts";
import type { PdfHighlight } from "@litagent/pdf";

export function pdfCommentHighlights(threads: ManuscriptCommentView[], files: ManuscriptFile[], build: TexBuild, boxes: TexSourceBox[], selected: string | null, activationKey: number): PdfHighlight[] {
  const highlights: PdfHighlight[] = [];
  for (const thread of threads) {
    if (thread.status !== "open" && thread.id !== selected) continue;
    const location = thread.location;
    const file = files.find((file) => file.path === location?.path);
    if (!file || !location?.revision || location.revision !== build.revisions[file.path] || file.revision !== location.revision || location.from === null || location.to === null || !["attached", "moved"].includes(location.state)) continue;
    const first = file.content.slice(0, location.from).split("\n").length;
    const last = file.content.slice(0, location.to).split("\n").length;
    const lines = file.content.split("\n");
    let paragraphEnd = last;
    while (paragraphEnd < lines.length && lines[paragraphEnd]?.trim() && !/^\s*\\(?:begin|end|(?:sub)*section|chapter)\b/.test(lines[paragraphEnd]!)) paragraphEnd++;
    const mapped = boxes.filter((box) => box.path === file.path && box.line >= first && box.line <= paragraphEnd);
    const pages = [...new Set(mapped.map((box) => box.page))].sort((a, b) => a - b);
    for (const page of pages) {
      const rects = mapped.filter((box) => box.page === page).map((box) => ({ page, x: box.x, y: box.y, width: box.width, height: box.height }));
      // Different source-line records can own the same rendered line.
      const uniqueRects = [...new Map(rects.map((rect) => [JSON.stringify(rect), rect])).values()];
      highlights.push({ id: thread.id, page, quote: thread.anchor?.quote ?? "", color: "yellow", active: thread.id === selected && page === pages[0],
        activationKey: thread.id === selected ? activationKey : 0, preferRects: true, rects: uniqueRects });
    }
  }
  return highlights;
}
