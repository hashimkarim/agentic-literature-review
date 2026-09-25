import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import type { ManuscriptDocument, TexSourceBox } from "@litagent/contracts";
import { sourceBoxes, sourceSelection } from "./tex-source-map";

const revision = "a".repeat(64);
const document = { files: [
  { path: "chapters/one.tex", content: "\\section{Study}\n\nA synthetic study\nwith a measurable result.\n", revision },
  { path: "appendix/one.tex", content: "A different result.", revision }
] } as ManuscriptDocument;
export function syntheticSyncTex() {
  return gzipSync(["SyncTeX Version:1", "Input:1:/work/./chapters/one.tex", "Input:2:/work/appendix/one.tex", "Input:3:/etc/private.tex", "Output:pdf", "Magnification:1000", "Unit:1", "X Offset:4736287", "Y Offset:4736287", "Content:", "{1", "(1,4:0,6578176:6578176,657818,0", ")", "(2,1:0,13156352:6578176,657818,0", ")", "(3,1:0,13156352:6578176,657818,0", ")", "}1", "Postamble:", "Count:3", "Post scriptum:", ""].join("\n"));
}
it("uses the packaged SyncTeX parser, engine offsets and full paths, excluding external inputs", () => {
  const boxes = sourceBoxes(syntheticSyncTex(), document);
  expect(boxes).toHaveLength(2);
  expect(boxes.map((box) => box.path)).toEqual(["chapters/one.tex", "appendix/one.tex"]);
  expect(boxes[0]!.x).toBeCloseTo(72);
  expect(boxes[0]!.y).toBeCloseTo(162);
  expect(boxes[0]!.height).toBeCloseTo(10);
  expect(() => sourceBoxes(Buffer.from("invalid"), document)).toThrow();
});

it("maps PDF line wraps to the exact source selection within its mapped paragraph", () => {
  const selection = sourceSelection(sourceBoxes(syntheticSyncTex(), document), {
    page: 1, rects: [{ x: 75, y: 163, width: 80, height: 8 }], quote: "synthetic study with a measurable result."
  }, document);
  expect(selection.path).toBe("chapters/one.tex");
  expect(selection.quote).toBe("synthetic study\nwith a measurable result.");
  expect(document.files[0]!.content.slice(selection.from, selection.to)).toBe(selection.quote);
  expect(selection.revision).toBe(revision);
});

it("maps included-file text from inner records, not the calling file's enclosing box", () => {
  const source = ["SyncTeX Version:1", "Input:1:/work/appendix/one.tex", "Input:2:/work/chapters/one.tex", "Output:xdv", "Magnification:1000", "Unit:1", "X Offset:0", "Y Offset:0", "Content:", "{1", "(1,1:0,6578176:6578176,657818,0", "g2,4:657818,6578176", "k1,1:6578176,6578176:5910358", "g1,1:6578176,6578176", ")", "}1", "Postamble:", ""].join("\n");
  const boxes = sourceBoxes(gzipSync(source), document);
  expect(boxes).toHaveLength(1);
  expect(boxes[0]).toMatchObject({ path: "chapters/one.tex", line: 4 });
});

it("keeps TeX expressions reviewable without inventing character correspondence", () => {
  const selection = sourceSelection(sourceBoxes(syntheticSyncTex(), document), {
    page: 1, rects: [{ x: 75, y: 163, width: 80, height: 8 }], quote: "Rendered equation"
  }, document);
  expect(selection.quote).toBe("A synthetic study\nwith a measurable result.");
});

it("rejects empty-page and cross-file selections rather than guessing a source", () => {
  const boxes = sourceBoxes(syntheticSyncTex(), document);
  expect(() => sourceSelection(boxes, { page: 2, rects: [{ x: 75, y: 163, width: 80, height: 8 }], quote: "text" }, document)).toThrow("no unique TeX location");
  expect(() => sourceSelection(boxes, { page: 1, rects: [{ x: 75, y: 163, width: 80, height: 108 }], quote: "text" }, document)).toThrow("no unique TeX location");
  const duplicate = [...boxes, { ...boxes[0], path: "appendix/one.tex", line: 1 } as TexSourceBox];
  expect(() => sourceSelection(duplicate, { page: 1, rects: [{ x: 75, y: 163, width: 80, height: 8 }], quote: "text" }, document)).toThrow("no unique TeX location");
});
