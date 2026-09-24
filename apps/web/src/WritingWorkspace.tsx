import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { FileCode2, FilePlus2, Plus, Save, History, Download, Trash2, Undo2, Redo2, Search, X, RotateCcw, BookmarkPlus, RefreshCw, ChevronLeft, Check, AlertTriangle, Sparkles, ListChecks, Link2, FolderKanban, Play, Square, Columns2, FileText, Terminal } from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "codemirror";
import { strToU8, zipSync } from "fflate";
import type { AgentProvider, Manuscript, ManuscriptDocument, ManuscriptFile, ManuscriptHistoryEntry, Project, TexDiagnostic, TexBuild } from "@litagent/contracts";
import { api, ApiError } from "./api";
import { WritingSession } from "./writing-session";
import { TexEditor, TextComparison } from "./TexEditor";
import { WritingCandidatesDialog, WritingCandidatesPanel, type WritingSelection } from "./WritingCandidates";
import { useWritingBuild, WritingPreview, WritingBuildLog } from "./WritingBuild";
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

function ProjectLinksDialog({ manuscript, projects, onUpdated, onClose }: { manuscript: Manuscript; projects: Project[]; onUpdated: (item: Manuscript) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [baseline, setBaseline] = useState(manuscript.projectIds);
  const [selected, setSelected] = useState(manuscript.projectIds);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  const options = [...projects, ...baseline.filter((id) => !projects.some((project) => project.id === id)).map((id) => ({ id, name: `Unavailable project (${id})` }))];
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { onUpdated(await api.updateManuscriptProjects(manuscript.id, selected, baseline)); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update project links."); setConflict(error instanceof ApiError && error.code === "manuscript_links_changed"); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError(null);
    try { const latest = await api.manuscript(manuscript.id); setBaseline(latest.projectIds); setSelected(latest.projectIds); onUpdated(latest); setConflict(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not reload project links."); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="writing-dialog writing-project-dialog" aria-labelledby="writing-project-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => void save(event)}>
      <header><h2 id="writing-project-title">Linked projects</h2><Tool label="Close dialog" disabled={busy} onClick={onClose}><X size={16} /></Tool></header>
      <p className="writing-project-document">{manuscript.name}</p>
      <label>Find projects<input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <fieldset disabled={busy}><legend>Projects <span>{selected.length} selected</span></legend>
        <div className="writing-project-options">{options.filter((project) => project.name.toLowerCase().includes(query.toLowerCase())).map((project) =>
          <label key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} /><FolderKanban size={16} /><span>{project.name}</span></label>
        )}{options.length === 0 && <p>No projects yet</p>}{options.length > 0 && !options.some((project) => project.name.toLowerCase().includes(query.toLowerCase())) && <p>No matching projects</p>}</div>
      </fieldset>
      {error && <p className="writing-error" role="alert">{error}</p>}
      <footer>{conflict && <button type="button" disabled={busy} onClick={() => void reload()}><RefreshCw size={15} />Reload links</button>}<button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="writing-primary" disabled={busy || conflict}><Check size={15} />{busy ? "Saving..." : "Save links"}</button></footer>
    </form>
  </dialog>;
}

export default function WritingWorkspace({ projects, providers }: { projects: Project[]; providers: AgentProvider[] }) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [active, setActive] = useState<string | null>(() => { try { return localStorage.getItem("la-writing-document"); } catch { return null; } });
  const [document, setDocument] = useState<ManuscriptDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [links, setLinks] = useState<Manuscript | null>(null);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  function openDocument(id: string | null) {
    setActive(id); setError(null);
    try { if (id) localStorage.setItem("la-writing-document", id); else localStorage.removeItem("la-writing-document"); } catch { /* Navigation also works without browser storage. */ }
  }
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    api.manuscripts().then((items) => { if (current) { setManuscripts(items); setLoading(false); } })
      .catch((error) => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; };
  }, [refresh]);
  useEffect(() => {
    if (!active) { setDocument(null); return; }
    let current = true;
    setDocument(null); setError(null);
    api.manuscript(active).then((result) => { if (current) setDocument(result); }).catch((error) => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [active, refresh]);
  const projectNames = (ids: string[]) => ids.map((id) => projects.find((project) => project.id === id)?.name ?? `Unavailable project (${id})`).join(", ");
  const visible = manuscripts.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) && (!projectFilter || (projectFilter === "unlinked" ? item.projectIds.length === 0 : item.projectIds.includes(projectFilter))));
  const currentDocument = document?.id === active ? document : null;
  return <section className="writing-workspace" aria-label="Writing workspace">
    <header className={`writing-heading${active ? " has-document" : ""}`}>
      {active ? <button type="button" onClick={() => openDocument(null)}><ChevronLeft size={16} />Documents</button> : <FileCode2 size={18} />}
      <h1 className="writing-document-name" title={currentDocument?.name}>{active ? currentDocument?.name ?? "Document" : "Documents"}</h1>
      <span className="writing-spacer" />
      {currentDocument && <button type="button" aria-label="Link projects" onClick={() => setLinks(currentDocument)}><Link2 size={16} />Projects <span>{currentDocument.projectIds.length}</span></button>}
      <button type="button" className="writing-primary writing-new-document" aria-label="New document" title="New document" onClick={() => setCreating(true)}><Plus size={16} /><span>New document</span></button>
    </header>
    {error && <div className="writing-banner" role="alert">{error}<Tool label="Retry loading documents" onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} /></Tool></div>}
    {active ? currentDocument ? <>
      <div className="writing-project-summary"><FolderKanban size={14} /><span title={projectNames(currentDocument.projectIds)}>{currentDocument.projectIds.length ? projectNames(currentDocument.projectIds) : "No linked projects"}</span></div>
      <ManuscriptEditor key={currentDocument.id} document={currentDocument} providers={providers} />
    </> : <div className="writing-empty"><FileCode2 size={32} /><h2>{error ? "Document unavailable" : "Loading document..."}</h2></div> : <>
      <div className="writing-document-filters">
        <label className="writing-document-search"><Search size={16} /><input type="search" aria-label="Find documents" placeholder="Find documents..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filter documents by project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option><option value="unlinked">No linked projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        <span>{visible.length} {visible.length === 1 ? "document" : "documents"}</span>
        <Tool label="Refresh documents" disabled={loading} onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} /></Tool>
      </div>
      {loading ? <div className="writing-empty"><h2>Loading documents...</h2></div> : visible.length ? <div className="writing-document-list"><table aria-label="Writing documents"><thead><tr><th>Document</th><th>Linked projects</th><th className="writing-created">Created</th><th aria-label="Actions" /></tr></thead><tbody>{visible.map((item) => <tr key={item.id}>
        <td><button type="button" className="writing-open-document" onClick={() => openDocument(item.id)}><FileCode2 size={18} /><span>{item.name}</span></button></td>
        <td><span className="writing-document-projects" title={projectNames(item.projectIds)}>{item.projectIds.length ? projectNames(item.projectIds) : "No linked projects"}</span></td>
        <td className="writing-created"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString()}</time></td>
        <td><Tool label={`Link projects to ${item.name}`} onClick={() => setLinks(item)}><Link2 size={16} /></Tool></td>
      </tr>)}</tbody></table></div> : <div className="writing-empty"><FileCode2 size={32} /><h2>{error ? "Documents unavailable" : query || projectFilter ? "No matching documents" : "No documents yet"}</h2></div>}
    </>}
    {creating && <NameDialog title="New document" label="Title" onClose={() => setCreating(false)} onSubmit={async (name) => { const created = await api.createManuscript(name); setManuscripts((items) => [created, ...items]); openDocument(created.id); }} />}
    {links && <ProjectLinksDialog manuscript={links} projects={projects} onClose={() => setLinks(null)} onUpdated={(updated) => {
      setManuscripts((items) => items.map((item) => item.id === updated.id ? { ...item, projectIds: updated.projectIds } : item));
      setDocument((current) => current?.id === updated.id ? { ...current, projectIds: updated.projectIds } : current);
    }} />}
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
  const build = useWritingBuild(id);
  const [viewMode, setViewMode] = useState<"source" | "split" | "preview">("source");
  const [buildLogOpen, setBuildLogOpen] = useState(false);
  const [jump, setJump] = useState<{ path: string; line: number } | null>(null);
  const historyRequest = useRef(0);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!jump || active !== jump.path || !editor.current) return;
    const view = editor.current;
    const line = view.state.doc.line(Math.min(jump.line, view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus(); setJump(null);
  }, [active, jump]);
  useEffect(() => { if (build.state?.latest?.status === "failed") setBuildLogOpen(true); }, [build.state?.latest?.id, build.state?.latest?.status]);
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
  const lastGood = build.state?.lastSuccessful;
  const previewStale = !!lastGood && (Object.keys(lastGood.revisions).length !== Object.keys(state.files).length || Object.values(state.files).some((item) => item.state !== "saved" || lastGood.revisions[item.path] !== item.revision));
  const compiling = build.state?.latest?.status === "running";
  function jumpToDiagnostic(diagnostic: TexDiagnostic, source: TexBuild) {
    if (!diagnostic.path || !diagnostic.line) return;
    const current = session.getSnapshot().files[diagnostic.path];
    if (!current || current.state !== "saved" || current.revision !== source.revisions[diagnostic.path]) { setError("This error refers to an earlier source revision. Compile your current draft for an accurate location."); return; }
    setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); setViewMode(window.innerWidth > 1100 ? "split" : "source");
    setActive(diagnostic.path); setJump({ path: diagnostic.path, line: diagnostic.line });
  }
  const canGenerate = viewMode !== "preview" && !!file && active.endsWith(".tex") && selection.to > selection.from && selection.to - selection.from <= 8000 && !compare && !candidateReview;
  return <div className="writing-document">
    <div className="writing-toolbar">
      <select className="writing-mobile-files" aria-label="Active file" value={active} onChange={(event) => { setActive(event.target.value); if (viewMode === "preview") setViewMode("source"); }} disabled={busy}>{Object.keys(state.files).map((name) => <option key={name}>{name}</option>)}</select>
      <span className="writing-current-path" title={active}>{active || "No file selected"}</span>
      <span className={`writing-save-state writing-save-${file?.state ?? "saved"}`} role="status">{file?.state === "saved" ? "Saved" : file?.state === "saving" ? "Saving..." : file?.state === "recovered" ? "Recovered draft" : file?.state === "conflict" ? "Conflict" : file?.state === "error" ? "Save failed" : "Unsaved changes"}</span>
      <span className="writing-spacer" />
      <Tool label="New TeX or BibTeX file" disabled={busy} onClick={() => setDialog("file")}><FilePlus2 size={16} /></Tool>
      <Tool label="Undo" disabled={viewMode === "preview" || busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) undo(editor.current); }}><Undo2 size={16} /></Tool>
      <Tool label="Redo" disabled={viewMode === "preview" || busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) redo(editor.current); }}><Redo2 size={16} /></Tool>
      <Tool label="Find in file" disabled={viewMode === "preview" || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) openSearchPanel(editor.current); }}><Search size={16} /></Tool>
      <Tool label="Save file" disabled={busy || !file || file.state === "saved" || file.state === "saving" || file.state === "conflict"} onClick={() => void session.save(active)}><Save size={16} /></Tool>
      <Tool label="Generate alternatives" title={canGenerate ? "Generate alternatives" : "Select up to 8,000 characters of TeX prose"} disabled={busy || !canGenerate} onClick={() => void run(async () => {
        const range = editor.current?.state.selection.main;
        if (!range || range.empty) return;
        await requireSaved(); const current = session.getSnapshot().files[active]!;
        setGenerating({ file: { path: current.path, content: current.content, revision: current.revision }, from: range.from, to: range.to });
      })}><Sparkles size={16} /></Tool>
      <Tool label="Saved alternatives" disabled={busy || !file} aria-pressed={candidatesOpen} onClick={() => { setViewMode("source"); setCandidatesOpen((open) => !open); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); }}><ListChecks size={16} /></Tool>
      <Tool label="File history" disabled={busy || !file} aria-pressed={history !== null} onClick={() => { setViewMode("source"); setCandidatesOpen(false); setCandidateReview(null); if (history) { setHistory(null); setHistorical(null); } else void run(loadHistory); }}><History size={16} /></Tool>
      <Tool label="Export TeX sources" disabled={busy} onClick={() => void run(exportSources)}><Download size={16} /></Tool>
    </div>
    <div className="writing-build-toolbar">
      {compiling ? <button type="button" disabled={build.pending} onClick={() => void build.cancel()}><Square size={14} />Cancel build</button> : <button type="button" className="writing-primary" disabled={busy || build.pending || !build.state?.runtime.available} onClick={() => {
        setViewMode(window.innerWidth > 1100 ? "split" : "preview");
        void build.compile(async () => { await requireSaved(); return Object.fromEntries(Object.values(session.getSnapshot().files).map((item) => [item.path, item.revision])); });
      }}><Play size={14} />{build.pending ? "Saving..." : "Compile"}</button>}
      <span className="writing-build-status" role="status">{compiling ? "Compiling..." : build.state?.latest ? ({ succeeded: "Build succeeded", failed: "Build failed", cancelled: "Build cancelled", interrupted: "Build interrupted", running: "Compiling..." })[build.state.latest.status] : build.state?.runtime.available ? "Ready to compile" : build.state ? "Compiler unavailable" : "Checking compiler..."}</span>
      <span className="writing-spacer" />
      <div className="writing-view-modes" role="group" aria-label="Editor layout">
        <Tool label="Source only" aria-pressed={viewMode === "source"} onClick={() => setViewMode("source")}><FileCode2 size={16} /></Tool>
        <Tool label="Split source and PDF" aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}><Columns2 size={16} /></Tool>
        <Tool label="PDF only" aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}><FileText size={16} /></Tool>
      </div>
      <Tool label="Build output" aria-pressed={buildLogOpen} disabled={!build.state?.latest} onClick={() => setBuildLogOpen((open) => !open)}><Terminal size={16} /></Tool>
    </div>
    {build.error && <div className="writing-banner" role="alert"><AlertTriangle size={16} /><span>{build.error}</span><Tool label="Refresh build status" onClick={() => void build.refresh()}><RefreshCw size={16} /></Tool></div>}
    {(error || state.storageError) && <div className="writing-banner" role="alert"><AlertTriangle size={16} />{error ?? state.storageError}</div>}
    {(file?.state === "conflict" || file?.state === "error" || file?.state === "recovered") && <div className="writing-banner" role="alert">
      <span>{file.state === "recovered" ? "Recovered unsaved text. Review before saving." : file.error}</span>
      {file.state !== "conflict" && <button type="button" disabled={busy} onClick={() => void session.save(active)}><Save size={14} />{file.state === "error" ? "Retry save" : "Save recovered draft"}</button>}
      <button type="button" disabled={busy} onClick={() => void run(async () => { const saved = (await api.manuscript(id)).files.find((item) => item.path === active); if (!saved) throw new Error("The saved file was deleted. Export your text before recreating it."); setHistorical(null); setRemote(saved); })}><History size={14} />Compare saved version</button>
    </div>}
    <div className={`writing-body${history !== null ? " has-history" : ""}${candidatesOpen ? " has-candidates" : ""}`}>
      <aside className="writing-files" aria-label="Manuscript files">
        <header><span>Files</span></header>
        <nav>{Object.values(state.files).map((item) => <button key={item.path} type="button" className={active === item.path ? "active" : ""} aria-current={active === item.path ? "true" : undefined} disabled={busy} title={item.path} onClick={() => { setActive(item.path); if (viewMode === "preview") setViewMode("source"); }}><FileCode2 size={15} /><span>{item.path}</span>{item.state !== "saved" && <span aria-label="Unsaved" className="writing-dirty-dot" />}</button>)}</nav>
        <footer><span>{Object.keys(state.files).length} files</span><Tool label="Delete selected file" disabled={busy || !file || active === document.entryFile} onClick={() => { if (window.confirm(`Delete ${active}?`)) void run(async () => { await requireSaved(); const current = session.getSnapshot().files[active]!; await api.deleteManuscriptFile(id, active, current.revision); session.remove(active); setActive(document.entryFile); }); }}><Trash2 size={15} /></Tool></footer>
      </aside>
      <div className={`writing-editor-preview writing-mode-${viewMode}`}>
      <main className="writing-source">
        {candidateReview ? <><div className="writing-diff-heading"><span>Original selection</span><span>{candidateReview.label}</span><Tool label="Close candidate comparison" onClick={() => setCandidateReview(null)}><X size={16} /></Tool></div><TextComparison before={candidateReview.before} after={candidateReview.after} /></> : compare && file ? <><div className="writing-diff-heading"><span>{historical?.entry.label ?? (historical ? new Date(historical.entry.savedAt).toLocaleString() : "Saved on disk")}</span><span>Current draft</span><Tool label="Close comparison" onClick={() => { setHistorical(null); setRemote(null); }}><X size={16} /></Tool></div><TextComparison before={compare.content} after={file.content} />
          <div className="writing-review-actions">
            <button type="button" disabled={busy} onClick={() => { setHistorical(null); setRemote(null); }}><ChevronLeft size={15} />Back to editor</button>
            {historical ? <button type="button" className="writing-primary" disabled={busy} onClick={() => void run(async () => { await requireSaved(); const current = session.getSnapshot().files[active]!; const restored = await api.restoreManuscriptFile(id, active, historical.entry.id, current.revision); session.acceptRemote(restored); setHistorical(null); await loadHistory(); })}><RotateCcw size={15} />Restore this version</button> : <><button type="button" disabled={busy} onClick={() => { session.acceptRemote(compare); setRemote(null); }}>Use saved version</button><button type="button" className="writing-primary" disabled={busy} onClick={() => { session.acceptRemote(compare, true); setRemote(null); }}>Save my version</button></>}
          </div></> : file ? <TexEditor filePath={active} content={file.content} disabled={busy} onChange={(content) => session.edit(active, content)} onView={(view) => { editor.current = view; }} onSelection={setSelection} /> : <div className="writing-empty"><h2>No source files</h2><button type="button" onClick={() => setDialog("file")}><FilePlus2 size={16} />New file</button></div>}
      </main>
      {viewMode !== "source" && <WritingPreview manuscriptId={id} state={build.state} stale={previewStale} onRefresh={() => void build.refresh()} />}
      </div>
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
    {buildLogOpen && build.state?.latest && <WritingBuildLog build={build.state.latest} onJump={jumpToDiagnostic} />}
    {generating && <WritingCandidatesDialog manuscriptId={id} selection={generating} providers={providers} onClose={() => setGenerating(null)} onCreated={(batch) => {
      setGenerating(null); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); setInitialBatchId(batch.id); setCandidatesOpen(true);
    }} />}
    {dialog && <NameDialog title={dialog === "file" ? "New file" : "Name this version"} label={dialog === "file" ? "Relative file path" : "Version name"} initial={dialog === "file" ? "sections/methods.tex" : ""} onClose={() => setDialog(null)} onSubmit={async (value) => {
      if (dialog === "file") { const saved = await api.writeManuscriptFile(id, { path: value, content: "", expectedRevision: null }); session.acceptRemote(saved); setActive(saved.path); setViewMode("source"); }
      else { await requireSaved(); await api.manuscriptCheckpoint(id, active, session.getSnapshot().files[active]!.revision, value); await loadHistory(); }
    }} />}
  </div>;
}
