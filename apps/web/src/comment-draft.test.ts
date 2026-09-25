import { expect, it } from "vitest";
import { CommentDraftStore, commentDraftKey } from "./comment-draft";
import type { CreateManuscriptComment } from "@litagent/contracts";

const draft: CreateManuscriptComment = { requestId: "642f746f-366f-4097-92cc-cf5b8e2e60e8", body: "Keep this comment.", selection: { path: "main.tex", revision: "a".repeat(64), from: 0, to: 10, quote: "One claim." } };
function storage() {
  const records = new Map<string, string>();
  return { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
}
it("recovers the captured selection and empty or populated body, removing posted/discarded drafts", () => {
  const local = storage(), first = new CommentDraftStore("doc", local);
  first.load(); first.save({ ...draft, body: "" });
  expect(new CommentDraftStore("doc", local).load()).toEqual({ ...draft, body: "" });
  first.save(draft);
  const reopened = new CommentDraftStore("doc", local);
  expect(reopened.load()).toEqual(draft);
  reopened.save(null);
  expect(local.getItem(commentDraftKey("doc"))).toBeNull();
});
it("does not overwrite a different tab's draft or confuse documents", () => {
  const local = storage(), first = new CommentDraftStore("doc", local), second = new CommentDraftStore("doc", local);
  first.load(); second.load(); first.save(draft);
  expect(() => second.save({ ...draft, body: "Another tab" })).toThrow("Another tab");
  expect(new CommentDraftStore("doc", local).load()).toEqual(draft);
  expect(new CommentDraftStore("other", local).load()).toBeNull();
});
it("reports unavailable recovery rather than pretending an unsent draft was stored", () => {
  const store = new CommentDraftStore("doc", null);
  expect(store.load()).toBeNull();
  expect(() => store.save(draft)).toThrow("unavailable");
  expect(() => store.save(null)).not.toThrow();
});
it("tolerates an earlier explicit null record and clears it", () => {
  const local = storage(); local.setItem(commentDraftKey("doc"), "null");
  const store = new CommentDraftStore("doc", local);
  expect(store.load()).toBeNull(); store.save(null);
  expect(local.getItem(commentDraftKey("doc"))).toBeNull();
});
