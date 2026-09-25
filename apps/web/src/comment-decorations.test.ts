import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { ManuscriptCommentView, ManuscriptFile } from "@litagent/contracts";
import { commentDecorations, commentMarks, setCommentMarks } from "./comment-decorations";
import { parseWritingView } from "./writing-view";
import { ManuscriptDocumentSchema } from "@litagent/contracts";

const file: ManuscriptFile = { path: "main.tex", content: "One claim. Another sentence.", revision: "a".repeat(64) };
const thread: ManuscriptCommentView = {
  id: "comment_" + "b".repeat(24), manuscriptId: "manuscript_" + "c".repeat(16), version: 1, status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [],
  anchor: { path: file.path, revision: file.revision, from: 0, to: 10, quote: "One claim.", prefix: "", suffix: " Another sentence." },
  location: { state: "attached", path: file.path, revision: file.revision, from: 0, to: 10, line: 1 }
};

it("only decorates open comments on the exact saved source revision and quote", () => {
  expect(commentMarks([thread], file, thread.id, true)).toEqual([{ id: thread.id, from: 0, to: 10, selected: true }]);
  expect(commentMarks([thread], file, null, false)).toEqual([]);
  expect(commentMarks([{ ...thread, status: "resolved" }], file, null, true)).toEqual([]);
  expect(commentMarks([thread], { ...file, revision: "d".repeat(64) }, null, true)).toEqual([]);
  expect(commentMarks([thread], { ...file, content: "Edited text" }, null, true)).toEqual([]);
  expect(commentMarks([thread], { ...file, path: "other.tex" }, null, true)).toEqual([]);
});

it("maps comment decorations through editor transactions and clears them on invalidation", () => {
  let state = EditorState.create({ doc: file.content, extensions: [commentDecorations] });
  state = state.update({ effects: setCommentMarks.of(commentMarks([thread], file, thread.id, true)) }).state;
  expect(state.field(commentDecorations).size).toBe(1);
  state = state.update({ changes: { from: 0, insert: "Preface. " } }).state;
  const positions: number[] = [];
  state.field(commentDecorations).between(0, state.doc.length, (from) => { positions.push(from); });
  expect(positions).toEqual([9]);
  state = state.update({ effects: setCommentMarks.of([]) }).state;
  expect(state.field(commentDecorations).size).toBe(0);
});

it("restores the comments panel without changing split layout or active file", () => {
  const document = ManuscriptDocumentSchema.parse({ id: thread.manuscriptId, name: "Fixture", projectIds: [], entryFile: file.path, createdAt: thread.createdAt, files: [file] });
  expect(parseWritingView({ panel: "comments", mode: "split", sourcePercent: 62, active: "main.tex" }, document)).toMatchObject({ panel: "comments", mode: "split", sourcePercent: 62, active: "main.tex" });
});
