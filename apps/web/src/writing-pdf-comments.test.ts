import { expect, it } from "vitest";
import type { ManuscriptCommentView, ManuscriptFile, TexBuild, TexSourceBox } from "@litagent/contracts";
import { pdfCommentHighlights } from "./writing-pdf-comments";

const revision = "a".repeat(64);
const content = "\\section{Study}\n\nA synthetic study\nwith measured results.\n\nNext paragraph.";
const file = { path: "chapters/study.tex", revision, content } as ManuscriptFile;
const from = content.indexOf("synthetic"), to = from + "synthetic study".length;
const thread = { id: "comment_a", status: "open", anchor: { quote: content.slice(from, to) }, location: { state: "attached", path: file.path, revision, from, to, line: 3 } } as ManuscriptCommentView;
const build = { revisions: { [file.path]: revision } } as TexBuild;
const boxes: TexSourceBox[] = [{ path: file.path, line: 4, page: 2, x: 70, y: 120, width: 300, height: 12 }, { path: file.path, line: 6, page: 2, x: 70, y: 200, width: 300, height: 12 }];

it("links the same comment ID to its compiled paragraph without spilling into the next one", () => {
  const [highlight] = pdfCommentHighlights([thread], [file], build, boxes, thread.id, 3);
  expect(highlight).toMatchObject({ id: thread.id, page: 2, active: true, activationKey: 3, preferRects: true });
  expect(highlight?.rects).toHaveLength(1);
});

it("draws shared line boxes once when several source lines map to the same PDF line", () => {
  const [highlight] = pdfCommentHighlights([thread], [file], build, [...boxes, { ...boxes[0]!, line: 3 }], thread.id, 0);
  expect(highlight?.rects).toHaveLength(1);
});

it("hides outdated and resolved marks, but allows locating a selected resolved thread", () => {
  expect(pdfCommentHighlights([{ ...thread, status: "resolved" }], [file], build, boxes, null, 0)).toEqual([]);
  expect(pdfCommentHighlights([{ ...thread, status: "resolved" }], [file], build, boxes, thread.id, 1)).toHaveLength(1);
  expect(pdfCommentHighlights([thread], [{ ...file, revision: "b".repeat(64) }], build, boxes, thread.id, 1)).toEqual([]);
  expect(pdfCommentHighlights([{ ...thread, location: { ...thread.location!, state: "outdated" } }], [file], build, boxes, null, 0)).toEqual([]);
});

it("keeps a multi-page comment linked on both pages, jumping only to its first page", () => {
  const highlights = pdfCommentHighlights([thread], [file], build, [...boxes, { ...boxes[0]!, page: 3 }], thread.id, 8);
  expect(highlights.map(({ id, page, active }) => ({ id, page, active }))).toEqual([
    { id: thread.id, page: 2, active: true }, { id: thread.id, page: 3, active: false }
  ]);
});
