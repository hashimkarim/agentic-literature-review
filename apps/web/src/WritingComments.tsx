import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CornerDownRight, FileText, GitCompareArrows, Link2, MessageSquare, MessageSquarePlus, Pencil, RefreshCw, RotateCcw, Search, Send, Trash2, X } from "lucide-react";
import { type CreateManuscriptComment, type ManuscriptCommentView } from "@litagent/contracts";
import type { CommentAction, useWritingComments } from "./writing-comments";
import { useBrowserPreference } from "./browser-preferences";
import { useCommentDraft } from "./comment-draft";

type Comments = ReturnType<typeof useWritingComments>;
function Icon({ label, children, ...props }: { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="writing-tool" title={label} aria-label={label} {...props}>{children}</button>;
}

export function WritingComments({ id, visible, comments, activePath, selected, onSelect, onJump, onJumpPdf, onClose, onCapture, canComment, incoming, onConsumed, disabled, acceptanceIssue, onAccept, onCompare }: {
  id: string; visible: boolean; comments: Comments; activePath: string; selected: string | null;
  onSelect: (id: string) => void; onJump: (thread: ManuscriptCommentView) => void; onClose: () => void;
  onJumpPdf: (thread: ManuscriptCommentView) => void;
  onCapture: () => Promise<CreateManuscriptComment["selection"]>; canComment: boolean;
  incoming: CreateManuscriptComment | null; onConsumed: () => void;
  disabled: boolean; acceptanceIssue: (thread: ManuscriptCommentView) => string | null;
  onAccept: (thread: ManuscriptCommentView) => Promise<void>; onCompare: (thread: ManuscriptCommentView) => void;
}) {
  // Keep a captured selection and draft together; an unrelated file switch must
  // never silently retarget an unsent comment.
  const { draft, setDraft, recoveryError } = useCommentDraft(id);
  const [status, setStatus] = useBrowserPreference<"open" | "resolved" | "all">(`litagent:comment-filter:v1:${id}`, "open", (value) => value === "resolved" || value === "all" ? value : "open");
  const [scope, setScope] = useState<"file" | "all">("all");
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  useEffect(() => {
    if (!incoming) return;
    if ((draft?.body.trim() || draft?.replacement !== undefined) && !window.confirm("Discard the unsent review and start on a new selection?")) { onConsumed(); return; }
    setDraft(incoming); setLocalError(null); onConsumed();
  }, [incoming]);
  useEffect(() => {
    if (!visible || !selected) return;
    const thread = comments.threads.find((item) => item.id === selected);
    if (thread) { setStatus(thread.status === "resolved" ? "resolved" : "open"); setScope("all"); setQuery(""); }
  }, [selected, visible]);
  useEffect(() => {
    if (visible && selected) document.getElementById(`review-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [selected, visible, status]);
  if (!visible) return null;
  const busy = disabled || comments.busy || capturing;
  const run = async (action: () => Promise<unknown>) => { setLocalError(null); try { await action(); } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not update comments."); } };
  async function capture() {
    setCapturing(true);
    try {
      if ((draft?.body.trim() || draft?.replacement !== undefined) && !window.confirm("Discard the unsent review and start on a new selection?")) return;
      setDraft({ requestId: crypto.randomUUID(), selection: await onCapture(), body: "" });
    } finally { setCapturing(false); }
  }
  const filtered = comments.threads.filter((thread) => (status === "all" || thread.status === status) && (scope === "all" || thread.anchor?.path === activePath) &&
    `${thread.anchor?.quote ?? ""} ${thread.suggestion?.replacement ?? ""} ${thread.anchor?.path ?? ""} ${thread.messages.map((message) => message.body ?? "").join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const counts = { open: comments.threads.filter((thread) => thread.status === "open").length, resolved: comments.threads.filter((thread) => thread.status === "resolved").length, all: comments.threads.length };
  return <aside className="writing-comments" aria-label="Document comments">
    <header><MessageSquare size={16} /><h2>Comments</h2><span>{counts.open} open</span>
      <Icon label="Add comment on selection" disabled={busy || !canComment} onClick={() => void run(capture)}><MessageSquarePlus size={16} /></Icon>
      <Icon label="Refresh comments" disabled={busy} onClick={() => { setLocalError(null); void comments.refresh(); }}><RefreshCw size={15} /></Icon>
      <Icon label="Close comments" onClick={onClose}><X size={16} /></Icon>
    </header>
    <div className="writing-comment-filters">
      <div role="group" aria-label="Comment status">{(["open", "resolved", "all"] as const).map((value) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value === "open" ? "Open" : value === "resolved" ? "Resolved" : "All"}<span>{counts[value]}</span></button>)}</div>
      <div><label><Search size={14} /><input type="search" aria-label="Search comments" placeholder="Search comments" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Comment file filter" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}><option value="all">All files</option><option value="file">Current file</option></select></div>
    </div>
    {(localError || comments.error) && <p className="writing-comment-error" role="alert">{localError ?? comments.error}</p>}
    {recoveryError && <p className="writing-comment-error" role="alert">{recoveryError}</p>}
    {draft && <form className="writing-comment-compose" aria-label="New comment" onSubmit={(event) => { event.preventDefault(); void run(async () => { const saved = await comments.create({ ...draft, body: draft.replacement !== undefined && !draft.body.trim() ? "Suggested replacement" : draft.body }); setDraft(null); onSelect(saved.id); setStatus("open"); }); }}>
      <div><strong>{draft.replacement === undefined ? "New comment" : "New suggestion"}</strong><Icon label="Discard comment draft" disabled={busy} onClick={() => { if ((!draft.body.trim() && draft.replacement === undefined) || window.confirm("Discard this unsent review?")) setDraft(null); }}><X size={15} /></Icon></div>
      <div className="writing-review-mode" role="group" aria-label="Review type">
        <button type="button" aria-pressed={draft.replacement === undefined} disabled={busy} onClick={() => { if (draft.replacement !== undefined && draft.replacement !== draft.selection.quote && !window.confirm("Discard the proposed replacement and keep only the comment?")) return; const { replacement: _replacement, ...comment } = draft; setDraft(comment); }}><MessageSquare size={14} />Comment</button>
        <button type="button" aria-pressed={draft.replacement !== undefined} disabled={busy} onClick={() => setDraft({ ...draft, replacement: draft.replacement ?? draft.selection.quote })}><Pencil size={14} />Suggest edit</button>
      </div>
      <span className="writing-comment-path">{draft.selection.path}</span><blockquote>{draft.selection.quote}</blockquote>
      {draft.replacement !== undefined && <label className="writing-suggestion-input">Replacement<textarea aria-label="Suggested replacement" maxLength={8000} rows={4} value={draft.replacement} disabled={busy} onChange={(event) => setDraft({ ...draft, replacement: event.target.value })} />{draft.replacement === "" && <span>Delete selected text</span>}</label>}
      <textarea autoFocus aria-label="Comment text" maxLength={8000} rows={draft.replacement === undefined ? 3 : 2} placeholder={draft.replacement === undefined ? "Comment..." : "Reason (optional)"} value={draft.body} disabled={busy} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
      <footer><span>{(draft.replacement ?? draft.body).length}/8000</span><button type="submit" className="writing-primary" disabled={busy || (draft.replacement === undefined ? !draft.body.trim() : draft.replacement === draft.selection.quote)}><Send size={14} />{draft.replacement === undefined ? "Comment" : "Suggest"}</button></footer>
    </form>}
    <div className="writing-comment-list" aria-live="polite">
      {comments.loading ? <p className="writing-no-drafts">Loading comments...</p> : !filtered.length ? <div className="writing-comments-empty"><MessageSquare size={24} /><p>{query || scope === "file" ? "No matching comments" : status === "resolved" ? "No resolved comments" : "No open comments"}</p></div> : filtered.map((thread) =>
        <CommentThread key={thread.id} thread={thread} selected={selected === thread.id} disabled={busy} canComment={canComment} onSelect={() => onSelect(thread.id)} onJump={() => onJump(thread)} onJumpPdf={() => onJumpPdf(thread)}
          update={async (action) => { const saved = await comments.update(thread, action); if (action.action === "reject-suggestion") { setStatus("resolved"); onSelect(thread.id); } return saved; }} onCapture={onCapture} acceptanceIssue={acceptanceIssue(thread)} onAccept={async () => { await onAccept(thread); setStatus("resolved"); }} onCompare={() => onCompare(thread)} />)}
    </div>
  </aside>;
}

function CommentThread({ thread, selected, disabled, canComment, onSelect, onJump, onJumpPdf, update, onCapture, acceptanceIssue, onAccept, onCompare }: {
  thread: ManuscriptCommentView; selected: boolean; disabled: boolean; canComment: boolean;
  onSelect: () => void; onJump: () => void; onJumpPdf: () => void; update: (action: CommentAction) => Promise<ManuscriptCommentView>;
  onCapture: () => Promise<CreateManuscriptComment["selection"]>;
  acceptanceIssue: string | null; onAccept: () => Promise<void>; onCompare: () => void;
}) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return; pending.current = true; setError(null);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Could not update thread."); }
    finally { pending.current = false; }
  };
  const location = thread.location;
  const attached = location?.state === "attached" || location?.state === "moved";
  const suggestion = thread.suggestion, awaitingDecision = suggestion?.status === "pending";
  const decided = suggestion && !awaitingDecision;
  const staleSuggestion = awaitingDecision && location?.revision !== thread.anchor?.revision;
  return <article id={`review-${thread.id}`} className={`writing-comment-thread${selected ? " selected" : ""}`} aria-label={`Comment on ${thread.anchor?.path}`}>
    <div className="writing-comment-thread-head"><button type="button" className="writing-comment-location" title={thread.anchor?.path} onClick={() => { onSelect(); if (attached) onJump(); }}><CornerDownRight size={14} /><span>{thread.anchor?.path}</span>{attached && <small>L{location.line}</small>}</button>
      <Icon label="Show comment in PDF" disabled={!attached} onClick={onJumpPdf}><FileText size={15} /></Icon>
      {!awaitingDecision && <Icon label={thread.status === "resolved" ? "Reopen thread" : "Resolve thread"} disabled={disabled} onClick={() => void run(() => update({ action: thread.status === "resolved" ? "reopen" : "resolve" }))}>{thread.status === "resolved" ? <RotateCcw size={15} /> : <Check size={15} />}</Icon>}
      <Icon label="Delete thread" disabled={disabled} onClick={() => { if (window.confirm("Delete this comment thread and all replies?")) void run(() => update({ action: "delete" })); }}><Trash2 size={14} /></Icon>
    </div>
    <button type="button" className="writing-comment-quote" disabled={!attached} title={attached ? "Jump to commented text" : "Original selected text"} onClick={() => { onSelect(); onJump(); }}>{thread.anchor?.quote}</button>
    {(!attached || staleSuggestion) && !decided && <div className="writing-comment-detached"><span>{location?.state === "missing" ? "File removed" : "Source changed"}</span><Icon label="Attach thread to current selection" disabled={disabled || !canComment} onClick={() => void run(async () => update({ action: "reattach", selection: await onCapture() }))}><Link2 size={15} /></Icon></div>}
    {suggestion && <section className="writing-suggestion" aria-label="Suggested edit">
      <header><strong>{awaitingDecision ? "Proposed replacement" : suggestion.status === "accepted" ? "Suggestion accepted" : "Suggestion rejected"}</strong><Icon label="Compare suggested edit" disabled={disabled} onClick={onCompare}><GitCompareArrows size={16} /></Icon></header>
      <pre className={suggestion.replacement ? "" : "writing-suggestion-deletion"}>{suggestion.replacement || "Delete selected text"}</pre>
      {awaitingDecision && <>
        {acceptanceIssue && <p className="writing-suggestion-notice">{acceptanceIssue}</p>}
        <footer><button type="button" disabled={disabled} onClick={() => void run(() => update({ action: "reject-suggestion" }))}><X size={14} />Reject</button><button type="button" className="writing-primary" disabled={disabled || !!acceptanceIssue} title={acceptanceIssue ?? "Apply this replacement to the source"} onClick={() => void run(async () => { await onAccept(); onSelect(); })}><Check size={14} />Accept suggestion</button></footer>
      </>}
    </section>}
    {thread.messages.map((message) => <div key={message.id} className="writing-comment-message">
      <div><strong>Local author</strong><time title={new Date(message.createdAt).toLocaleString()} dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{message.editedAt && message.body ? " (edited)" : ""}</time>
        {message.body !== null && <><Icon label="Edit comment" disabled={disabled} onClick={() => setEditing({ id: message.id, body: message.body! })}><Pencil size={13} /></Icon><Icon label="Delete comment" disabled={disabled} onClick={() => { if (window.confirm("Delete this comment?")) void run(() => update({ action: "delete-message", messageId: message.id })); }}><Trash2 size={13} /></Icon></>}
      </div>
      {editing?.id === message.id ? <form onSubmit={(event: FormEvent) => { event.preventDefault(); void run(async () => { await update({ action: "edit", messageId: message.id, body: editing.body }); setEditing(null); }); }}>
        <textarea autoFocus aria-label="Edit comment text" rows={3} maxLength={8000} value={editing.body} disabled={disabled} onChange={(event) => setEditing({ id: message.id, body: event.target.value })} />
        <footer><button type="button" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button><button type="submit" disabled={disabled || !editing.body.trim()}><Check size={14} />Save</button></footer>
      </form> : <p className={message.body === null ? "deleted" : ""}>{message.body ?? "Comment deleted"}</p>}
    </div>)}
    {thread.status === "open" && <form className="writing-comment-reply" onSubmit={(event) => { event.preventDefault(); void run(async () => { await update({ action: "reply", body: reply }); setReply(""); }); }}>
      <textarea aria-label="Reply to thread" placeholder="Reply..." rows={2} maxLength={8000} value={reply} disabled={disabled} onChange={(event) => setReply(event.target.value)} />
      <footer><button type="submit" disabled={disabled || !reply.trim()}><Send size={13} />Reply</button></footer>
    </form>}
    {error && <p role="alert" className="writing-comment-error">{error}</p>}
  </article>;
}
