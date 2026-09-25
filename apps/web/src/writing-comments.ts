import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateManuscriptComment, ManuscriptCommentView, UpdateManuscriptComment } from "@litagent/contracts";
import { api } from "./api";

export type CommentAction = UpdateManuscriptComment extends infer T ? T extends UpdateManuscriptComment ? Omit<T, "requestId" | "expectedVersion"> : never : never;

export function useWritingComments(id: string, revisions: string) {
  const [threads, setThreads] = useState<ManuscriptCommentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), inFlight = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const items = await api.manuscriptComments(id);
      if (request === sequence.current) { setThreads(items); setLoading(false); setError(null); }
    } catch (error) { if (request === sequence.current) { setError(error instanceof Error ? error.message : "Could not load comments."); setLoading(false); } }
  }, [id]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh, revisions]);
  useEffect(() => {
    const reload = () => { if (!inFlight.current) void refresh(); };
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [refresh]);
  async function save(action: () => Promise<ManuscriptCommentView>) {
    if (inFlight.current) throw new Error("A comment is still saving.");
    inFlight.current = true; setBusy(true); setError(null); sequence.current++;
    try {
      const saved = await action(); sequence.current++; setLoading(false);
      setThreads((current) => [...current.filter((item) => item.id !== saved.id), ...(saved.status === "deleted" ? [] : [saved])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      return saved;
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save comment."); throw error; }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { threads, loading, busy, error, refresh,
    create: (input: CreateManuscriptComment) => save(() => api.createManuscriptComment(id, input)),
    update: (thread: ManuscriptCommentView, action: CommentAction) => save(() => api.updateManuscriptComment(id, thread.id, { ...action, expectedVersion: thread.version, requestId: crypto.randomUUID() }))
  };
}
