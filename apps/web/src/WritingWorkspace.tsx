import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { FileCode2, FilePlus2, Plus, Save, History, Download, Trash2, Undo2, Redo2, Search, X, RotateCcw, BookmarkPlus, RefreshCw, ChevronLeft, Check, AlertTriangle, Sparkles, ListChecks } from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "codemirror";
import { strToU8, zipSync } from "fflate";
import type { AgentProvider, Manuscript, ManuscriptDocument, ManuscriptFile, ManuscriptHistoryEntry, Project } from "@litagent/contracts";
import { api } from "./api";
import { WritingSession } from "./writing-session";
import { TexEditor, TextComparison } from "./TexEditor";
import { WritingCandidatesDialog, WritingCandidatesPanel, type WritingSelection } from "./WritingCandidates";
import "./writing.css";

function Tool({ label, children, ...props }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="writing-tool" aria-label={label} title={label} {...props}>{children}</button>;
}
function NameDialog({ title, label, initial = "", onSubmit, onClose }: { title: string; label: string; initial?: string; onSubmit: (value: string) => Promise<void>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await onSubmit(value); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); } finally { setBusy(false); }
  }
  return <dialog ref={ref} className="writing-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="writing-dialog-title">
    <form onSubmit={(event) => void submit(event)}>
      <header><h2 id="writing-dialog-title">{title}</h2><Tool label="Close dialog" disabled={busy} onClick={onClose}><X size={16} /></Tool></header>
      <label>{label}<input autoFocus required maxLength={160} value={value} onChange={(event) => setValue(event.target.value)} /></label>
      {error && <p role="alert" className="writing-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="writing-primary" disabled={busy || !value.trim()}><Check size={15} />{busy ? "Saving..." : "Save"}</button></footer>
    </form>
  </dialog>;
}

export default function WritingWorkspace({ projectId, projects, providers, onProjectChange }: { projectId: string; projects: Project[]; providers: AgentProvider[]; onProjectChange: (id: string) => void }) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [document, setDocument] = useState<ManuscriptDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    api.manuscripts(projectId).then((items) => { if (current) { setManuscripts(items); setActive((id) => id ?? items[0]?.id ?? null); setLoading(false); } })
      .catch((error) => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; };
  }, [projectId, refresh]);
  useEffect(() => {
    if (!active) { setDocument(null); return; }
    let current = true;
    setDocument(null); setError(null);
    api.manuscript(active).then((result) => { if (current) setDocument(result); }).catch((error) => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [projectId, active, refresh]);
  return <section className="writing-workspace" aria-label="Writing workspace">
    <header className="writing-heading">
      <FileCode2 size={18} /><h1>Writing</h1>
      <select aria-label="Writing project" value={projectId} onChange={(event) => onProjectChange(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      {manuscripts.length > 0 && <select aria-label="Manuscript" value={active ?? ""} onChange={(event) => setActive(event.target.value)}>{manuscripts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <span className="writing-spacer" />
      <button type="button" className="writing-primary" onClick={() => setCreating(true)}><Plus size={16} />New manuscript</button>
    </header>
    {error && <div className="writing-banner" role="alert">{error}<Tool label="Retry loading manuscripts" onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} /></Tool></div>}
    {document ? <ManuscriptEditor key={document.id} document={document} providers={providers} /> : <div className="writing-empty"><FileCode2 size={32} /><h2>{loading || active && !error ? "Loading manuscript..." : "No manuscripts"}</h2>{!loading && !active && !error && <button type="button" className="writing-primary" onClick={() => setCreating(true)}><Plus size={16} />New manuscript</button>}</div>}
    {creating && <NameDialog title="New manuscript" label="Title" onClose={() => setCreating(false)} onSubmit={async (name) => { const created = await api.createManuscript(name, [projectId]); setManuscripts((items) => [created, ...items]); setActive(created.id); }} />}
  </section>;
}

function ManuscriptEditor({ document, providers }: { document: ManuscriptDocument; providers: AgentProvider[] }) {
  const { id } = document;
  const [session] = useState(() => {
    let storage: Storage | null = null;
    let clientId: string = crypto.randomUUID();
    try { storage = window.localStorage; clientId = sessionStorage.getItem("litagent-writing-client") ?? clientId; sessionStorage.setItem("litagent-writing-client", clientId); } catch { /* Server saves remain usable without browser storage. */ }
    return new WritingSession(document, (input) => api.writeManuscriptFile(id, input), storage, clientId);
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [active, setActive] = useState(document.files.some((file) => file.path === document.entryFile) ? document.entryFile : document.files[0]?.path ?? "");
  const file = state.files[active];
  const [dialog, setDialog] = useState<"file" | "checkpoint" | null>(null);
  const [history, setHistory] = useState<ManuscriptHistoryEntry[] | null>(null);
  const [historical, setHistorical] = useState<{ entry: ManuscriptHistoryEntry; file: ManuscriptFile } | null>(null);
  const [remote, setRemote] = useState<ManuscriptFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const [generating, setGenerating] = useState<WritingSelection | null>(null);
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [initialBatchId, setInitialBatchId] = useState<string | null>(null);
  const [candidateReview, setCandidateReview] = useState<{ before: string; after: string; label: string } | null>(null);
  const historyRequest = useRef(0);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => () => { session.dispose(); }, [session]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.values(session.getSnapshot().files).some((file) => file.state !== "saved")) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [session]);
  useEffect(() => { historyRequest.current++; setHistory(null); setHistorical(null); setRemote(null); setError(null); setCandidateReview(null); setInitialBatchId(null); }, [active]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); } };
  const requireSaved = async () => { if (!await session.flush()) throw new Error("Save or resolve pending file changes first."); };
  async function loadHistory() {
    const request = ++historyRequest.current;
    const items = await api.manuscriptHistory(id, active);
    if (request === historyRequest.current) { setHistory(items); setHistorical(null); }
  }
  async function exportSources() {
    await requireSaved();
    const current = await api.manuscript(id);
    const files = Object.fromEntries(current.files.map((file) => [file.path, strToU8(file.content)]));
    const bytes = zipSync(files);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
    const link = window.document.createElement("a"); link.href = url; link.download = `${document.name.replace(/[^A-Za-z0-9_-]+/g, "-") || "manuscript"}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const compare = historical?.file ?? remote;
  const canGenerate = !!file && active.endsWith(".tex") && selection.to > selection.from && selection.to - selection.from <= 8000 && !compare && !candidateReview;
  return <div className="writing-document">
    <div className="writing-toolbar">
      <select className="writing-mobile-files" aria-label="Active file" value={active} onChange={(event) => setActive(event.target.value)} disabled={busy}>{Object.keys(state.files).map((name) => <option key={name}>{name}</option>)}</select>
      <span className="writing-current-path" title={active}>{active || "No file selected"}</span>
      <span className={`writing-save-state writing-save-${file?.state ?? "saved"}`} role="status">{file?.state === "saved" ? "Saved" : file?.state === "saving" ? "Saving..." : file?.state === "recovered" ? "Recovered draft" : file?.state === "conflict" ? "Conflict" : file?.state === "error" ? "Save failed" : "Unsaved changes"}</span>
      <span className="writing-spacer" />
      <Tool label="New TeX or BibTeX file" disabled={busy} onClick={() => setDialog("file")}><FilePlus2 size={16} /></Tool>
      <Tool label="Undo" disabled={busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) undo(editor.current); }}><Undo2 size={16} /></Tool>
      <Tool label="Redo" disabled={busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) redo(editor.current); }}><Redo2 size={16} /></Tool>
      <Tool label="Find in file" disabled={!!compare || !!candidateReview || !file} onClick={() => { if (editor.current) openSearchPanel(editor.current); }}><Search size={16} /></Tool>
      <Tool label="Save file" disabled={busy || !file || file.state === "saved" || file.state === "saving" || file.state === "conflict"} onClick={() => void session.save(active)}><Save size={16} /></Tool>
      <Tool label="Generate alternatives" title={canGenerate ? "Generate alternatives" : "Select up to 8,000 characters of TeX prose"} disabled={busy || !canGenerate} onClick={() => void run(async () => {
        const range = editor.current?.state.selection.main;
        if (!range || range.empty) return;
        await requireSaved(); const current = session.getSnapshot().files[active]!;
        setGenerating({ file: { path: current.path, content: current.content, revision: current.revision }, from: range.from, to: range.to });
      })}><Sparkles size={16} /></Tool>
      <Tool label="Saved alternatives" disabled={busy || !file} aria-pressed={candidatesOpen} onClick={() => { setCandidatesOpen((open) => !open); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); }}><ListChecks size={16} /></Tool>
      <Tool label="File history" disabled={busy || !file} aria-pressed={history !== null} onClick={() => { setCandidatesOpen(false); setCandidateReview(null); if (history) { setHistory(null); setHistorical(null); } else void run(loadHistory); }}><History size={16} /></Tool>
      <Tool label="Export TeX sources" disabled={busy} onClick={() => void run(exportSources)}><Download size={16} /></Tool>
    </div>
    {(error || state.storageError) && <div className="writing-banner" role="alert"><AlertTriangle size={16} />{error ?? state.storageError}</div>}
    {(file?.state === "conflict" || file?.state === "error" || file?.state === "recovered") && <div className="writing-banner" role="alert">
      <span>{file.state === "recovered" ? "Recovered unsaved text. Review before saving." : file.error}</span>
      {file.state !== "conflict" && <button type="button" disabled={busy} onClick={() => void session.save(active)}><Save size={14} />{file.state === "error" ? "Retry save" : "Save recovered draft"}</button>}
      <button type="button" disabled={busy} onClick={() => void run(async () => { const saved = (await api.manuscript(id)).files.find((item) => item.path === active); if (!saved) throw new Error("The saved file was deleted. Export your text before recreating it."); setHistorical(null); setRemote(saved); })}><History size={14} />Compare saved version</button>
    </div>}
    <div className={`writing-body${history !== null ? " has-history" : ""}${candidatesOpen ? " has-candidates" : ""}`}>
      <aside className="writing-files" aria-label="Manuscript files">
        <header><span>Files</span></header>
        <nav>{Object.values(state.files).map((item) => <button key={item.path} type="button" className={active === item.path ? "active" : ""} aria-current={active === item.path ? "true" : undefined} disabled={busy} title={item.path} onClick={() => setActive(item.path)}><FileCode2 size={15} /><span>{item.path}</span>{item.state !== "saved" && <span aria-label="Unsaved" className="writing-dirty-dot" />}</button>)}</nav>
        <footer><span>{Object.keys(state.files).length} files</span><Tool label="Delete selected file" disabled={busy || !file || active === document.entryFile} onClick={() => { if (window.confirm(`Delete ${active}?`)) void run(async () => { await requireSaved(); const current = session.getSnapshot().files[active]!; await api.deleteManuscriptFile(id, active, current.revision); session.remove(active); setActive(document.entryFile); }); }}><Trash2 size={15} /></Tool></footer>
      </aside>
      <main className="writing-source">
        {candidateReview ? <><div className="writing-diff-heading"><span>Original selection</span><span>{candidateReview.label}</span><Tool label="Close candidate comparison" onClick={() => setCandidateReview(null)}><X size={16} /></Tool></div><TextComparison before={candidateReview.before} after={candidateReview.after} /></> : compare && file ? <><div className="writing-diff-heading"><span>{historical?.entry.label ?? (historical ? new Date(historical.entry.savedAt).toLocaleString() : "Saved on disk")}</span><span>Current draft</span><Tool label="Close comparison" onClick={() => { setHistorical(null); setRemote(null); }}><X size={16} /></Tool></div><TextComparison before={compare.content} after={file.content} />
          <div className="writing-review-actions">
            <button type="button" disabled={busy} onClick={() => { setHistorical(null); setRemote(null); }}><ChevronLeft size={15} />Back to editor</button>
            {historical ? <button type="button" className="writing-primary" disabled={busy} onClick={() => void run(async () => { await requireSaved(); const current = session.getSnapshot().files[active]!; const restored = await api.restoreManuscriptFile(id, active, historical.entry.id, current.revision); session.acceptRemote(restored); setHistorical(null); await loadHistory(); })}><RotateCcw size={15} />Restore this version</button> : <><button type="button" disabled={busy} onClick={() => { session.acceptRemote(compare); setRemote(null); }}>Use saved version</button><button type="button" className="writing-primary" disabled={busy} onClick={() => { session.acceptRemote(compare, true); setRemote(null); }}>Save my version</button></>}
          </div></> : file ? <TexEditor filePath={active} content={file.content} disabled={busy} onChange={(content) => session.edit(active, content)} onView={(view) => { editor.current = view; }} onSelection={setSelection} /> : <div className="writing-empty"><h2>No source files</h2><button type="button" onClick={() => setDialog("file")}><FilePlus2 size={16} />New file</button></div>}
      </main>
      {history !== null && <aside className="writing-history" aria-label="File history">
        <header><h2>History</h2><Tool label="Named checkpoint" disabled={busy} onClick={() => setDialog("checkpoint")}><BookmarkPlus size={16} /></Tool><Tool label="Refresh history" disabled={busy} onClick={() => void run(loadHistory)}><RefreshCw size={15} /></Tool></header>
        <div className="writing-history-path">{active}</div>
        <ol>{history.map((entry) => <li key={entry.id}><button type="button" disabled={busy} className={historical?.entry.id === entry.id ? "active" : ""} onClick={() => void run(async () => { const request = ++historyRequest.current; const saved = await api.manuscriptVersion(id, active, entry.id); if (request === historyRequest.current) { setHistorical({ entry, file: saved }); setRemote(null); } })}><span>{entry.label ?? ({ created: "Initial version", saved: "Autosave", external: "External edit", restored: "Restored version", checkpoint: "Checkpoint", deleted: "Before deletion", candidate: "Accepted candidate" })[entry.reason]}</span><time dateTime={entry.savedAt}>{new Date(entry.savedAt).toLocaleString()}</time><code>{entry.revision.slice(0, 8)}</code></button></li>)}</ol>
      </aside>}
      {candidatesOpen && file && <WritingCandidatesPanel key={active} manuscriptId={id} file={file} initialBatchId={initialBatchId} busy={busy}
        onClose={() => { setCandidatesOpen(false); setCandidateReview(null); }}
        onClearComparison={() => setCandidateReview(null)}
        onCompare={(batch, candidateId) => { const index = batch.candidates.findIndex((candidate) => candidate.id === candidateId); const item = batch.candidates[index]; if (item?.text !== null && item?.text !== undefined) { setHistorical(null); setRemote(null); setCandidateReview({ before: batch.selectedText, after: item.text, label: `Candidate ${index + 1} / ${item.model}` }); } }}
        onAccept={async (batch, candidateId) => {
          setBusy(true);
          try {
            await requireSaved();
            const current = session.getSnapshot().files[batch.request.path];
            if (!current) throw new Error("The source file is no longer open.");
            const saved = await api.acceptWritingCandidate(id, batch.id, candidateId, current.revision);
            session.acceptRemote(saved); setCandidateReview(null);
          } finally { setBusy(false); }
        }} />}
    </div>
    {generating && <WritingCandidatesDialog manuscriptId={id} selection={generating} providers={providers} onClose={() => setGenerating(null)} onCreated={(batch) => {
      setGenerating(null); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); setInitialBatchId(batch.id); setCandidatesOpen(true);
    }} />}
    {dialog && <NameDialog title={dialog === "file" ? "New file" : "Name this version"} label={dialog === "file" ? "Relative file path" : "Version name"} initial={dialog === "file" ? "sections/methods.tex" : ""} onClose={() => setDialog(null)} onSubmit={async (value) => {
      if (dialog === "file") { const saved = await api.writeManuscriptFile(id, { path: value, content: "", expectedRevision: null }); session.acceptRemote(saved); setActive(saved.path); }
      else { await requireSaved(); await api.manuscriptCheckpoint(id, active, session.getSnapshot().files[active]!.revision, value); await loadHistory(); }
    }} />}
  </div>;
}
