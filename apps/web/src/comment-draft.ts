import { useEffect, useState } from "react";
import { z } from "zod";
import { CreateManuscriptCommentSchema, type CreateManuscriptComment } from "@litagent/contracts";

const DraftSchema = CreateManuscriptCommentSchema.extend({ body: z.string().max(8000) });
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const commentDraftKey = (id: string) => `litagent:comment-draft:v1:${id}`;

export class CommentDraftStore {
  private previous: string | null = null;
  readonly key: string;
  constructor(id: string, private storage: DraftStorage | null) { this.key = commentDraftKey(id); }
  load(): CreateManuscriptComment | null {
    if (!this.storage) return null;
    this.previous = this.storage.getItem(this.key);
    if (!this.previous) return null;
    return DraftSchema.nullable().parse(JSON.parse(this.previous));
  }
  save(draft: CreateManuscriptComment | null) {
    if (!this.storage) {
      if (!draft) return;
      throw new Error("Comment draft recovery is unavailable. Keep this tab open until the comment is posted.");
    }
    if (this.storage.getItem(this.key) !== this.previous) throw new Error("Another tab changed the saved comment draft. This tab's draft remains open; it has not overwritten the other draft.");
    const next = draft ? JSON.stringify(DraftSchema.parse(draft)) : null;
    if (next === this.previous) return;
    if (next === null) this.storage.removeItem(this.key); else this.storage.setItem(this.key, next);
    this.previous = next;
  }
}

export function useCommentDraft(id: string) {
  const [initial] = useState(() => {
    let storage: DraftStorage | null = null;
    try { storage = window.localStorage; } catch { /* Posting still works without recovery. */ }
    const store = new CommentDraftStore(id, storage);
    try { return { store, draft: store.load(), error: null as string | null }; }
    catch { return { store, draft: null, error: "The saved comment draft could not be recovered. Its browser record has been preserved." }; }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [recoveryError, setRecoveryError] = useState(initial.error);
  useEffect(() => {
    // Do not erase an unreadable record just because the panel mounted.
    if (initial.error && draft === null) return;
    try { initial.store.save(draft); setRecoveryError(null); }
    catch (error) { setRecoveryError(error instanceof Error && error.message.startsWith("Another tab") ? error.message : "Comment draft recovery is unavailable. Keep this tab open until the comment is posted."); }
  }, [draft, initial]);
  return { draft, setDraft, recoveryError };
}
