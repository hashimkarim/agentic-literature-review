import { expect, it } from "vitest";
import type { ManuscriptCommentView, ManuscriptFile } from "@litagent/contracts";
import { suggestionIssue } from "./writing-suggestions";

const file: ManuscriptFile = { path: "main.tex", revision: "a".repeat(64), content: "A broad claim." };
const thread: ManuscriptCommentView = { id: "comment_" + "a".repeat(24), manuscriptId: "manuscript_" + "b".repeat(16), version: 1, status: "open", createdAt: "2026-09-27T12:00:00Z", updatedAt: "2026-09-27T12:00:00Z", messages: [],
  anchor: { path: file.path, revision: file.revision, from: 0, to: file.content.length, quote: file.content, prefix: "", suffix: "" },
  location: { state: "attached", path: file.path, revision: file.revision, from: 0, to: file.content.length, line: 1 }, suggestion: { status: "pending", replacement: "A narrow claim." } };

it("enables acceptance only on the saved, exact reviewed source", () => {
  expect(suggestionIssue(thread, { ...file, state: "saved" })).toBeNull();
  expect(suggestionIssue(thread)).toMatch(/unavailable/);
  expect(suggestionIssue(thread, { ...file, path: "other.tex" })).toMatch(/unavailable/);
  for (const state of ["saving", "conflict", "dirty", "error"]) expect(suggestionIssue(thread, { ...file, state })).toMatch(/Save or resolve/);
  expect(suggestionIssue(thread, { ...file, revision: "b".repeat(64) })).toMatch(/reattach/);
  expect(suggestionIssue(thread, { ...file, content: "A forged claim." })).toMatch(/reattach/);
  expect(suggestionIssue({ ...thread, status: "deleted" }, file)).toMatch(/decided/);
  expect(suggestionIssue({ ...thread, suggestion: { replacement: "", status: "rejected", decidedAt: thread.createdAt, decision: { id: "fixture", hash: file.revision } } }, file)).toMatch(/decided/);
});
