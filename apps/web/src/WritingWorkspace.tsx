import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { FileCode2, FilePlus2, Plus, Save, History, Download, Trash2, Undo2, Redo2, Search, X, RotateCcw, BookmarkPlus, RefreshCw, ChevronLeft, Check, AlertTriangle, Sparkles, ListChecks, Link2, FolderKanban, Play, Square, Columns2, FileText, Terminal, Upload, FolderPlus, FolderTree, Pencil, PanelLeftClose, PanelLeftOpen, MessageSquare, MessageSquarePlus } from "lucide-react";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "codemirror";
import type { AgentProvider, Manuscript, ManuscriptDocument, ManuscriptFile, ManuscriptHistoryEntry, Project, TexDiagnostic, TexBuild, WritingCandidateBatch, CreateManuscriptComment, ManuscriptCommentView } from "@litagent/contracts";
import { api, ApiError } from "./api";
import { WritingSession } from "./writing-session";
import { TexEditor, TextComparison } from "./TexEditor";
import { WritingCandidatesDialog, WritingCandidatesPanel, type WritingSelection } from "./WritingCandidates";
import { useWritingBuild, WritingPreview, WritingBuildLog } from "./WritingBuild";
import { WritingImport } from "./WritingImport";
import { WritingFileTree, WritingFileTabs, WritingAsset } from "./WritingFiles";
import { WritingAssistant } from "./WritingAssistant";
import { WritingActions, WritingDivider } from "./WritingLayout";
import { WritingComments } from "./WritingComments";
import { useWritingComments } from "./writing-comments";
import { commentMarks } from "./comment-decorations";
import { useBrowserPreference } from "./browser-preferences";
import { defaultWritingView, parseWritingView, reconcileWritingView, writingViewKey, type WritingView } from "./writing-view";
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

export default function WritingWorkspace({ projects, providers, onConfigureProviders }: { projects: Project[]; providers: AgentProvider[]; onConfigureProviders: () => void }) {
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [active, setActive] = useState<string | null>(() => { try { return localStorage.getItem("la-writing-document"); } catch { return null; } });
  const [document, setDocument] = useState<ManuscriptDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
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
      {currentDocument && <button type="button" aria-label="Link projects" title={projectNames(currentDocument.projectIds) || "No linked projects"} onClick={() => setLinks(currentDocument)}><Link2 size={16} /><span className="writing-project-label">Projects</span><span>{currentDocument.projectIds.length}</span></button>}
      <button type="button" className="writing-import-button" aria-label="Import writing document" title="Import folder or Overleaf ZIP" onClick={() => setImporting(true)}><Upload size={16} /><span>Import</span></button>
      <button type="button" className="writing-primary writing-new-document" aria-label="New document" title="New document" onClick={() => setCreating(true)}><Plus size={16} /><span>New document</span></button>
    </header>
    {error && <div className="writing-banner" role="alert">{error}<Tool label="Retry loading documents" onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} /></Tool></div>}
    {active ? currentDocument ? <>
      <ManuscriptEditor key={currentDocument.id} document={currentDocument} providers={providers} onConfigureProviders={onConfigureProviders} />
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
    {importing && <WritingImport projects={projects} onClose={() => setImporting(false)} onImported={(created) => { setImporting(false); setManuscripts((items) => [created, ...items.filter((item) => item.id !== created.id)]); openDocument(created.id); }} />}
    {links && <ProjectLinksDialog manuscript={links} projects={projects} onClose={() => setLinks(null)} onUpdated={(updated) => {
      setManuscripts((items) => items.map((item) => item.id === updated.id ? { ...item, projectIds: updated.projectIds } : item));
      setDocument((current) => current?.id === updated.id ? { ...current, projectIds: updated.projectIds } : current);
    }} />}
  </section>;
}

function ManuscriptEditor({ document, providers, onConfigureProviders }: { document: ManuscriptDocument; providers: AgentProvider[]; onConfigureProviders: () => void }) {
  const { id } = document;
  const [tree, setTree] = useState(document);
  const [session] = useState(() => {
    let storage: Storage | null = null;
    let clientId: string = crypto.randomUUID();
    try { storage = window.localStorage; clientId = sessionStorage.getItem("litagent-writing-client") ?? clientId; sessionStorage.setItem("litagent-writing-client", clientId); } catch { /* Server saves remain usable without browser storage. */ }
    return new WritingSession(document, (input) => api.writeManuscriptFile(id, input), storage, clientId);
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [view, setView] = useBrowserPreference(writingViewKey(id), defaultWritingView(document, window.innerWidth > 1100), (value) => parseWritingView(value, document, window.innerWidth > 1100));
  function preference<K extends keyof WritingView>(key: K, value: SetStateAction<WritingView[K]>) {
    setView((previous) => ({ ...previous, [key]: typeof value === "function" ? (value as (current: WritingView[K]) => WritingView[K])(previous[key]) : value }));
  }
  const { active, selected, openFiles, buildLogOpen } = view;
  const setActive = (value: string) => preference("active", value);
  const setSelected = (value: string) => preference("selected", value);
  const setOpenFiles = (value: SetStateAction<string[]>) => preference("openFiles", value);
  const setBuildLogOpen = (value: SetStateAction<boolean>) => preference("buildLogOpen", value);
  const setViewMode = (value: WritingView["mode"]) => preference("mode", value);
  const [filesOpen, setFilesOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const file = state.files[active];
  const asset = tree.assets?.find((file) => file.path === active);
  const [dialog, setDialog] = useState<"file" | "folder" | "move" | "checkpoint" | null>(null);
  const [history, setHistory] = useState<ManuscriptHistoryEntry[] | null>(null);
  const [historical, setHistorical] = useState<{ entry: ManuscriptHistoryEntry; file: ManuscriptFile } | null>(null);
  const [remote, setRemote] = useState<ManuscriptFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState({ from: 0, to: 0 });
  const [generating, setGenerating] = useState<WritingSelection | null>(null);
  const candidatesOpen = view.panel === "candidates", assistantOpen = view.panel === "assistant", historyOpen = view.panel === "history", commentsOpen = view.panel === "comments";
  const comments = useWritingComments(id, Object.values(state.files).map((file) => `${file.path}:${file.revision}`).sort().join("|"));
  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const [commentActivation, setCommentActivation] = useState(0);
  const [incomingComment, setIncomingComment] = useState<CreateManuscriptComment | null>(null);
  const marks = useMemo(() => commentMarks(comments.threads, file, selectedComment, file?.state === "saved"), [comments.threads, file, selectedComment]);
  function setPanelOpen(panel: WritingView["panel"], value: SetStateAction<boolean>) {
    preference("panel", (current) => (typeof value === "function" ? value(current === panel) : value) ? panel : current === panel ? "none" : current);
  }
  const setCandidatesOpen = (value: SetStateAction<boolean>) => setPanelOpen("candidates", value);
  const setAssistantOpen = (value: SetStateAction<boolean>) => setPanelOpen("assistant", value);
  const [initialBatchId, setInitialBatchId] = useState<string | null>(null);
  const [candidateReview, setCandidateReview] = useState<{ before: string; after: string; label: string } | null>(null);
  const build = useWritingBuild(id);
  // A temporary comparison must not overwrite the user's preferred editor layout.
  const viewMode = candidateReview || historical || remote ? "source" : view.mode;
  const [jump, setJump] = useState<{ path: string; line: number } | { path: string; from: number; to: number; revision: string } | null>(null);
  const historyRequest = useRef(0);
  const editor = useRef<EditorView | null>(null);
  useEffect(() => {
    if (!jump || active !== jump.path || !editor.current) return;
    const view = editor.current;
    if ("revision" in jump && (file?.state !== "saved" || file.revision !== jump.revision)) { setError("Comment location changed. Save the file and refresh comments."); setJump(null); return; }
    const range = "line" in jump ? view.state.doc.line(Math.min(jump.line, view.state.doc.lines)) : jump;
    view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
    view.focus(); setJump(null);
  }, [active, jump]);
  const observedBuild = useRef<string | null>(null);
  useEffect(() => {
    const latest = build.state?.latest;
    if (!latest) return;
    if (observedBuild.current === `${latest.id}:running` && latest.status === "failed") setBuildLogOpen(true);
    observedBuild.current = `${latest.id}:${latest.status}`;
  }, [build.state?.latest?.id, build.state?.latest?.status]);
  useEffect(() => () => { session.dispose(); }, [session]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.values(session.getSnapshot().files).some((file) => file.state !== "saved")) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [session]);
  useEffect(() => { historyRequest.current++; setHistory(null); setHistorical(null); setRemote(null); setError(null); setCandidateReview(null); setInitialBatchId(null); }, [active]);
  useEffect(() => {
    if (!historyOpen || !file) return;
    void loadHistory().catch((error) => setError(error instanceof Error ? error.message : "Could not load history."));
    return () => { historyRequest.current++; };
  }, [active, historyOpen]);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); } };
  const requireSaved = async () => { if (!await session.flush()) throw new Error("Save or resolve pending file changes first."); };
  const folderPath = tree.folders?.includes(selected) ? selected : selected.split("/").slice(0, -1).join("/");
  function selectFile(path: string) {
    setActive(path); setSelected(path); setFilesOpen(false);
    setOpenFiles((files) => files.includes(path) ? files : [...files, path]);
  }
  function acceptTree(next: ManuscriptDocument) {
    for (const name of Object.keys(session.getSnapshot().files)) if (!next.files.some((file) => file.path === name)) session.remove(name);
    for (const file of next.files) session.acceptRemote(file);
    setTree(next);
    setView((current) => reconcileWritingView(current, next));
  }
  async function savedTree() {
    await requireSaved();
    const latest = await api.manuscript(id);
    const local = Object.values(session.getSnapshot().files);
    if (latest.entryFile !== tree.entryFile || latest.files.length !== local.length || latest.files.some((file) => session.getSnapshot().files[file.path]?.revision !== file.revision) ||
      JSON.stringify(latest.assets ?? []) !== JSON.stringify(tree.assets ?? []) || JSON.stringify(latest.folders ?? []) !== JSON.stringify(tree.folders ?? [])) throw new Error("Files changed elsewhere. Reload files before reorganizing or compiling.");
    return latest;
  }
  async function loadHistory() {
    const request = ++historyRequest.current;
    try {
      const items = await api.manuscriptHistory(id, active);
      if (request === historyRequest.current) { setHistory(items); setHistorical(null); }
    } catch (error) { if (request === historyRequest.current) throw error; }
  }
  async function exportSources() {
    await requireSaved();
    const url = URL.createObjectURL(await api.manuscriptArchive(id));
    const link = window.document.createElement("a"); link.href = url; link.download = `${document.name.replace(/[^A-Za-z0-9_-]+/g, "-") || "manuscript"}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const compare = historical?.file ?? remote;
  const lastGood = build.state?.lastSuccessful;
  const previewStale = !!lastGood && ((lastGood.entryFile && lastGood.entryFile !== tree.entryFile) || Object.keys(lastGood.revisions).length !== Object.keys(state.files).length + (tree.assets?.length ?? 0) || Object.values(state.files).some((item) => item.state !== "saved" || lastGood.revisions[item.path] !== item.revision) || (tree.assets ?? []).some((item) => lastGood.revisions[item.path] !== item.revision));
  const compiling = build.state?.latest?.status === "running";
  const cursorLine = file ? file.content.slice(0, selection.to).split("\n").length : 0;
  function jumpToDiagnostic(diagnostic: TexDiagnostic, source: TexBuild) {
    if (!diagnostic.path || !diagnostic.line) return;
    const current = session.getSnapshot().files[diagnostic.path];
    if (!current || current.state !== "saved" || current.revision !== source.revisions[diagnostic.path]) { setError("This error refers to an earlier source revision. Compile your current draft for an accurate location."); return; }
    setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); if (view.mode === "preview") setViewMode("split");
    selectFile(diagnostic.path); setJump({ path: diagnostic.path, line: diagnostic.line });
  }
  const canGenerate = viewMode !== "preview" && !!file && active.endsWith(".tex") && selection.to > selection.from && selection.to - selection.from <= 8000 && !compare && !candidateReview;
  const canComment = viewMode !== "preview" && !!file && selection.to > selection.from && selection.to - selection.from <= 8000 && !compare && !candidateReview;
  async function captureComment(): Promise<CreateManuscriptComment["selection"]> {
    const currentEditor = editor.current;
    const range = currentEditor?.state.selection.main;
    if (!currentEditor || !range || range.empty || range.to - range.from > 8000) throw new Error("Select up to 8,000 characters in the source editor.");
    const path = active, quote = currentEditor.state.sliceDoc(range.from, range.to);
    setBusy(true);
    try {
      await requireSaved();
      const current = session.getSnapshot().files[path];
      if (!current || current.content.slice(range.from, range.to) !== quote) throw new Error("Selection changed. Select the text again.");
      return { path, revision: current.revision, from: range.from, to: range.to, quote };
    } finally { setBusy(false); }
  }
  function addComment() { void run(async () => { const selection = await captureComment(); setIncomingComment({ requestId: crypto.randomUUID(), selection, body: "" }); preference("panel", "comments"); setFilesOpen(false); }); }
  function selectComment(id: string) { setSelectedComment(id); setCommentActivation((value) => value + 1); }
  function commentFromPdf(selection: CreateManuscriptComment["selection"]) {
    const current = session.getSnapshot().files[selection.path];
    if (!current || current.state !== "saved" || current.revision !== selection.revision) throw new Error("Source changed. Save and compile before commenting on the PDF.");
    setIncomingComment({ requestId: crypto.randomUUID(), selection, body: "" });
    setHistorical(null); setRemote(null); setCandidateReview(null);
    selectFile(selection.path); setJump(selection);
    if (view.mode === "preview") setViewMode("split");
    preference("panel", "comments"); setFilesOpen(false);
  }
  function jumpToComment(thread: ManuscriptCommentView) {
    const location = thread.location;
    if (!location || location.from === null || location.to === null || !location.revision) return;
    const current = session.getSnapshot().files[location.path];
    if (!current || current.state !== "saved" || current.revision !== location.revision || current.content.slice(location.from, location.to) !== thread.anchor?.quote) {
      setError("Comment location changed. Save the file and refresh comments."); return;
    }
    setHistorical(null); setRemote(null); setCandidateReview(null); selectComment(thread.id);
    if (view.mode === "preview") setViewMode("split");
    selectFile(location.path); setJump({ path: location.path, from: location.from, to: location.to, revision: location.revision });
    if (window.matchMedia("(max-width: 1100px)").matches) preference("panel", "none");
  }
  function jumpToCommentPdf(thread: ManuscriptCommentView) {
    if (!lastGood || previewStale) { setError("Compile your saved changes to locate this comment in the PDF."); return; }
    setHistorical(null); setRemote(null); setCandidateReview(null);
    if (window.matchMedia("(max-width: 1100px)").matches) {
      setViewMode("preview"); preference("panel", "none");
    } else if (view.mode === "source") setViewMode("split");
    selectComment(thread.id);
  }
  const candidatePanel = file ? <WritingCandidatesPanel key={active} manuscriptId={id} file={file} initialBatchId={initialBatchId} busy={busy}
    bibliographyPaths={Object.keys(state.files).filter((name) => /\.bib$/i.test(name))}
    onClose={() => { setCandidatesOpen(false); setAssistantOpen(false); setCandidateReview(null); }}
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
    }}
    onReferences={async (batch, candidateId, path) => {
      setBusy(true);
      try {
        await requireSaved();
        const current = session.getSnapshot().files[path];
        if (!current) throw new Error("Reload the bibliography file before adding references.");
        session.acceptRemote(await api.writingReferences(id, batch.id, candidateId, path, current.revision));
      } finally { setBusy(false); }
    }} /> : <p className="writing-no-drafts">Open a text file to view its saved drafts.</p>;
  function created(batch: WritingCandidateBatch) {
    setGenerating(null); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); setInitialBatchId(batch.id);
  }
  return <div className="writing-document">
    <div className="writing-toolbar">
      <Tool label={view.filesVisible ? "Hide document files" : "Show document files"} className="writing-tool writing-desktop-tree" aria-expanded={view.filesVisible} onClick={() => preference("filesVisible", (visible) => !visible)}>{view.filesVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</Tool>
      <button type="button" className="writing-mobile-tree" aria-label="Toggle document files" aria-expanded={filesOpen} onClick={() => { setFilesOpen((open) => !open); if (!filesOpen) preference("panel", "none"); }}><FolderTree size={16} /></button>
      <div className="writing-build-toolbar">
        {compiling ? <button type="button" disabled={build.pending} onClick={() => void build.cancel()}><Square size={14} />Cancel build</button> : <button type="button" className="writing-primary" disabled={busy || build.pending || !build.state?.runtime.available} onClick={() => {
          void build.compile(async () => { const latest = await savedTree(); return Object.fromEntries([...latest.files, ...(latest.assets ?? [])].map((item) => [item.path, item.revision])); }, tree.entryFile);
        }}><Play size={14} />{build.pending ? "Saving..." : "Compile"}</button>}
      </div>
      <div className="writing-view-modes" role="group" aria-label="Editor layout">
        <Tool label="Source only" aria-pressed={viewMode === "source"} onClick={() => { setCandidateReview(null); setHistorical(null); setRemote(null); setViewMode("source"); }}><FileCode2 size={16} /></Tool>
        <Tool label="Split source and PDF" aria-pressed={viewMode === "split"} onClick={() => { setCandidateReview(null); setHistorical(null); setRemote(null); setViewMode("split"); }}><Columns2 size={16} /></Tool>
        <Tool label="PDF only" aria-pressed={viewMode === "preview"} onClick={() => { setCandidateReview(null); setHistorical(null); setRemote(null); setViewMode("preview"); }}><FileText size={16} /></Tool>
      </div>
      <div className="writing-edit-tools" role="group" aria-label="Edit source">
      <Tool label="Undo" disabled={viewMode === "preview" || busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) undo(editor.current); }}><Undo2 size={16} /></Tool>
      <Tool label="Redo" disabled={viewMode === "preview" || busy || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) redo(editor.current); }}><Redo2 size={16} /></Tool>
      <Tool label="Save file" disabled={busy || !file || file.state === "saved" || file.state === "saving" || file.state === "conflict"} onClick={() => void session.save(active)}><Save size={16} /></Tool>
      </div>
      <span className="writing-spacer" />
      <Tool label="Add comment" disabled={busy || !canComment} onClick={addComment}><MessageSquarePlus size={16} /></Tool>
      <Tool label="Document comments" aria-pressed={commentsOpen} onClick={() => { setPanelOpen("comments", !commentsOpen); setFilesOpen(false); }}><MessageSquare size={16} /></Tool>
      <Tool label="File history" disabled={busy || !file} aria-pressed={historyOpen} onClick={() => { setPanelOpen("history", !historyOpen); setCandidateReview(null); setHistorical(null); setRemote(null); }}><History size={16} /></Tool>
      <WritingActions>
      <Tool label="New TeX or BibTeX file" disabled={busy} onClick={() => setDialog("file")}><FilePlus2 size={16} /><span>New source file</span></Tool>
      <Tool label="Find in file" disabled={viewMode === "preview" || !!compare || !!candidateReview || !file} onClick={() => { if (editor.current) openSearchPanel(editor.current); }}><Search size={16} /><span>Find in file</span></Tool>
      <Tool label="Generate alternatives" title={canGenerate ? "Generate alternatives" : "Select up to 8,000 characters of TeX prose"} disabled={busy || !canGenerate} onClick={() => void run(async () => {
        const range = editor.current?.state.selection.main;
        if (!range || range.empty) return;
        await requireSaved(); const current = session.getSnapshot().files[active]!;
        setAssistantOpen(false);
        setGenerating({ file: { path: current.path, content: current.content, revision: current.revision }, from: range.from, to: range.to });
      })}><Sparkles size={16} /><span>Generate alternatives</span></Tool>
      <Tool label="Saved alternatives" disabled={busy || !file} aria-pressed={candidatesOpen} onClick={() => { setCandidatesOpen((open) => !open); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); }}><ListChecks size={16} /><span>Saved alternatives</span></Tool>
      <Tool label="Export TeX sources" disabled={busy} onClick={() => void run(exportSources)}><Download size={16} /><span>Export TeX sources</span></Tool>
      </WritingActions>
      <button type="button" className="writing-assistant-toggle" title="Document sources" aria-label="Document sources" onClick={() => { setAssistantOpen(true); preference("assistantTab", "sources"); setFilesOpen(false); }}><Link2 size={16} /><span>Sources</span></button>
      <button type="button" className="writing-assistant-toggle" title="AI assistant" aria-label="AI assistant" aria-pressed={assistantOpen} onClick={() => { setAssistantOpen((open) => !open); preference("assistantTab", "compose"); setFilesOpen(false); setHistory(null); setHistorical(null); setRemote(null); setCandidateReview(null); }}><Sparkles size={16} /><span>AI assistant</span></button>
    </div>
    {build.error && <div className="writing-banner" role="alert"><AlertTriangle size={16} /><span>{build.error}</span><Tool label="Refresh build status" onClick={() => void build.refresh()}><RefreshCw size={16} /></Tool></div>}
    {(error || state.storageError) && <div className="writing-banner" role="alert"><AlertTriangle size={16} />{error ?? state.storageError}</div>}
    {(file?.state === "conflict" || file?.state === "error" || file?.state === "recovered") && <div className="writing-banner" role="alert">
      <span>{file.state === "recovered" ? "Recovered unsaved text. Review before saving." : file.error}</span>
      {file.state !== "conflict" && <button type="button" disabled={busy} onClick={() => void session.save(active)}><Save size={14} />{file.state === "error" ? "Retry save" : "Save recovered draft"}</button>}
      <button type="button" disabled={busy} onClick={() => void run(async () => { const saved = (await api.manuscript(id)).files.find((item) => item.path === active); if (!saved) throw new Error("The saved file was deleted. Export your text before recreating it."); setHistorical(null); setRemote(saved); })}><History size={14} />Compare saved version</button>
    </div>}
    <div className={`writing-body${historyOpen ? " has-history" : ""}${candidatesOpen ? " has-candidates" : ""}${assistantOpen ? " has-assistant" : ""}${commentsOpen ? " has-comments" : ""}${filesOpen ? " files-open" : ""}${view.filesVisible ? "" : " files-hidden"}`}>
      <aside className="writing-files" aria-label="Manuscript files">
        <header><button type="button" className="writing-files-root" aria-pressed={selected === ""} onClick={() => setSelected("")} title="Document root">Files</button>
          <Tool label="New folder" disabled={busy || build.pending} onClick={() => setDialog("folder")}><FolderPlus size={15} /></Tool>
          <Tool label="Upload document files" disabled={busy || build.pending} onClick={() => upload.current?.click()}><Upload size={15} /></Tool>
          <Tool label="Reload files" disabled={busy || build.pending} onClick={() => void run(async () => { await requireSaved(); acceptTree(await api.manuscript(id)); })}><RefreshCw size={15} /></Tool>
          <Tool label="Close document files" className="writing-tool writing-mobile-tree" onClick={() => setFilesOpen(false)}><X size={15} /></Tool>
        </header>
        <label className="writing-entry-selector">Main file<select aria-label="Main TeX file" value={tree.entryFile} disabled={busy || build.pending || compiling} onChange={(event) => { const path = event.target.value; void run(async () => { const latest = await savedTree(); acceptTree(await api.changeManuscriptTree(id, { action: "entry", path, expectedRevision: latest.treeRevision! })); }); }}>{Object.keys(state.files).filter((name) => /\.tex$/i.test(name)).map((name) => <option key={name}>{name}</option>)}</select></label>
        <nav><WritingFileTree files={[...Object.values(state.files).map((file) => ({ path: file.path, dirty: file.state !== "saved" })), ...(tree.assets ?? []).map((file) => ({ path: file.path, asset: true }))]} folders={tree.folders ?? []} collapsedFolders={view.collapsedFolders} onCollapsedFoldersChange={(paths) => preference("collapsedFolders", paths)} selected={selected} mainFile={tree.entryFile} disabled={busy} onSelect={(path, folder) => { setSelected(path); if (!folder) selectFile(path); }} /></nav>
        <footer><span>{Object.keys(state.files).length + (tree.assets?.length ?? 0)} files</span>
          <Tool label="Rename or move selected item" disabled={busy || build.pending || !selected} onClick={() => setDialog("move")}><Pencil size={15} /></Tool>
          <Tool label="Delete selected file or folder" disabled={busy || build.pending || !selected || tree.entryFile === selected || tree.entryFile.startsWith(`${selected}/`)} onClick={() => { if (window.confirm(`Delete ${selected}${tree.folders?.includes(selected) ? " and its contents" : ""}?`)) void run(async () => { const latest = await savedTree(); acceptTree(await api.changeManuscriptTree(id, { action: "delete", path: selected, expectedRevision: latest.treeRevision! })); setSelected(""); }); }}><Trash2 size={15} /></Tool>
        </footer>
      </aside>
      <div className={`writing-editor-preview writing-mode-${viewMode}`} style={{ "--writing-split-tracks": `minmax(0, ${view.sourcePercent}fr) 6px minmax(0, ${100 - view.sourcePercent}fr)` } as CSSProperties}>
      <main className="writing-source">
        <WritingFileTabs paths={openFiles} active={active} onSelect={selectFile} onClose={(path) => { const remaining = openFiles.filter((item) => item !== path); const next = remaining.length ? remaining : [tree.entryFile]; setOpenFiles(next); if (active === path) selectFile(next.at(-1)!); }} />
        {candidateReview ? <><div className="writing-diff-heading"><span>Original selection</span><span>{candidateReview.label}</span><Tool label="Close candidate comparison" onClick={() => setCandidateReview(null)}><X size={16} /></Tool></div><TextComparison before={candidateReview.before} after={candidateReview.after} /></> : compare && file ? <><div className="writing-diff-heading"><span>{historical?.entry.label ?? (historical ? new Date(historical.entry.savedAt).toLocaleString() : "Saved on disk")}</span><span>Current draft</span><Tool label="Close comparison" onClick={() => { setHistorical(null); setRemote(null); }}><X size={16} /></Tool></div><TextComparison before={compare.content} after={file.content} />
          <div className="writing-review-actions">
            <button type="button" disabled={busy} onClick={() => { setHistorical(null); setRemote(null); }}><ChevronLeft size={15} />Back to editor</button>
            {historical ? <button type="button" className="writing-primary" disabled={busy} onClick={() => void run(async () => { await requireSaved(); const current = session.getSnapshot().files[active]!; const restored = await api.restoreManuscriptFile(id, active, historical.entry.id, current.revision); session.acceptRemote(restored); setHistorical(null); await loadHistory(); })}><RotateCcw size={15} />Restore this version</button> : <><button type="button" disabled={busy} onClick={() => { session.acceptRemote(compare); setRemote(null); }}>Use saved version</button><button type="button" className="writing-primary" disabled={busy} onClick={() => { session.acceptRemote(compare, true); setRemote(null); }}>Save my version</button></>}
          </div></> : asset ? <WritingAsset key={asset.path + asset.revision} id={id} asset={asset} /> : file ? <TexEditor filePath={active} content={file.content} disabled={busy} onChange={(content) => session.edit(active, content)} onView={(view) => { editor.current = view; }} onSelection={setSelection} comments={marks} onAddComment={addComment} onComment={(id) => { selectComment(id); preference("panel", "comments"); setFilesOpen(false); }} /> : <div className="writing-empty"><h2>No source files</h2><button type="button" onClick={() => setDialog("file")}><FilePlus2 size={16} />New file</button></div>}
      </main>
      {viewMode === "split" && <WritingDivider value={view.sourcePercent} onChange={(value) => preference("sourcePercent", value)} />}
      {viewMode !== "source" && <WritingPreview manuscriptId={id} state={build.state} stale={previewStale} onRefresh={() => void build.refresh()}
        comments={comments.threads} files={Object.values(state.files)} selectedComment={selectedComment} commentActivation={commentActivation}
        onComment={commentFromPdf} onSelectComment={(id) => { const thread = comments.threads.find((thread) => thread.id === id); if (thread) jumpToComment(thread); preference("panel", "comments"); }} />}
      </div>
      {historyOpen && <aside className="writing-history" aria-label="File history">
        <header><h2>History</h2><Tool label="Named checkpoint" disabled={busy || !file} onClick={() => setDialog("checkpoint")}><BookmarkPlus size={16} /></Tool><Tool label="Refresh history" disabled={busy || !file} onClick={() => void run(loadHistory)}><RefreshCw size={15} /></Tool><Tool label="Close file history" onClick={() => { preference("panel", "none"); setHistorical(null); }}><X size={15} /></Tool></header>
        <div className="writing-history-path">{active}</div>
        {!history && <p className="writing-no-drafts">{file ? "Loading history..." : "Open a text file to view its history."}</p>}
        <ol>{history?.map((entry) => <li key={entry.id}><button type="button" disabled={busy} className={historical?.entry.id === entry.id ? "active" : ""} onClick={() => void run(async () => { const request = ++historyRequest.current; const saved = await api.manuscriptVersion(id, active, entry.id); if (request === historyRequest.current) { setHistorical({ entry, file: saved }); setRemote(null); } })}><span>{entry.label ?? ({ created: "Initial version", saved: "Autosave", external: "External edit", restored: "Restored version", checkpoint: "Checkpoint", deleted: "Before deletion", candidate: "Accepted candidate" })[entry.reason]}</span><time dateTime={entry.savedAt}>{new Date(entry.savedAt).toLocaleString()}</time><code>{entry.revision.slice(0, 8)}</code></button></li>)}</ol>
      </aside>}
      {candidatesOpen && candidatePanel}
      <WritingComments id={id} visible={commentsOpen} comments={comments} activePath={active} selected={selectedComment} onSelect={selectComment} onJump={jumpToComment}
        onJumpPdf={jumpToCommentPdf}
        onClose={() => preference("panel", "none")} onCapture={captureComment} canComment={!busy && canComment} incoming={incomingComment} onConsumed={() => setIncomingComment(null)} />
      <WritingAssistant manuscriptId={id} file={file} selection={selection} providers={providers} visible={assistantOpen} disabled={busy || !!compare || !!candidateReview || viewMode === "preview"}
        tab={view.assistantTab} setTab={(tab) => preference("assistantTab", tab)} onConfigureProviders={onConfigureProviders}
        capture={async () => {
          const range = editor.current?.state.selection.main;
          if (!range || !file) throw new Error("Return to the TeX editor before generating.");
          setBusy(true);
          try { await requireSaved(); const current = session.getSnapshot().files[active]!; return { file: { path: current.path, content: current.content, revision: current.revision }, from: range.from, to: range.to }; }
          finally { setBusy(false); }
        }} onClose={() => setAssistantOpen(false)} onCreated={created} drafts={candidatePanel} />
    </div>
    {buildLogOpen && build.state?.latest && <WritingBuildLog build={build.state.latest} onJump={jumpToDiagnostic} />}
    <footer className="writing-statusbar">
      <span className="writing-current-path" title={active}>{active || "No file selected"}</span>
      <span className={`writing-save-state writing-save-${file?.state ?? "saved"}`} role="status">{asset ? "Asset" : file?.state === "saved" ? "Saved" : file?.state === "saving" ? "Saving..." : file?.state === "recovered" ? "Recovered draft" : file?.state === "conflict" ? "Conflict" : file?.state === "error" ? "Save failed" : "Unsaved changes"}</span>
      {file && <span className="writing-cursor-position">Ln {cursorLine}{selection.to > selection.from ? ` / ${selection.to - selection.from} selected` : ""}</span>}
      <span className="writing-spacer" />
      <span className="writing-build-status" role="status">{compiling ? build.state?.latest?.phase ?? "Compiling..." : build.state?.latest ? ({ succeeded: "Build succeeded", failed: "Build failed", cancelled: "Build cancelled", interrupted: "Build interrupted", running: "Compiling..." })[build.state.latest.status] : build.state?.runtime.available ? "Ready to compile" : build.state ? "Compiler unavailable" : "Checking compiler..."}</span>
      <Tool label="Build output" aria-pressed={buildLogOpen} disabled={!build.state?.latest} onClick={() => setBuildLogOpen((open) => !open)}><Terminal size={15} /></Tool>
    </footer>
    {generating && <WritingCandidatesDialog manuscriptId={id} selection={generating} providers={providers} onClose={() => setGenerating(null)} onCreated={(batch) => {
      created(batch); setAssistantOpen(false); setCandidatesOpen(true);
    }} />}
    <input hidden ref={upload} type="file" multiple aria-label="Upload manuscript files" onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = "";
      void run(async () => { let latest = await savedTree(); for (const file of files) { latest = await api.uploadManuscriptFile(id, file, folderPath ? `${folderPath}/${file.name}` : file.name, latest.treeRevision!); acceptTree(latest); } });
    }} />
    {dialog && <NameDialog title={({ file: "New file", folder: "New folder", move: "Rename or move", checkpoint: "Name this version" })[dialog]} label={dialog === "checkpoint" ? "Version name" : dialog === "move" ? "Destination path" : "Relative file path"}
      initial={dialog === "move" ? selected : dialog === "file" || dialog === "folder" ? `${folderPath ? `${folderPath}/` : ""}${dialog === "file" ? "untitled.tex" : "new-folder"}` : ""} onClose={() => setDialog(null)} onSubmit={async (value) => {
      if (dialog === "checkpoint") { await requireSaved(); await api.manuscriptCheckpoint(id, active, session.getSnapshot().files[active]!.revision, value); await loadHistory(); return; }
      const latest = await savedTree();
      if (dialog === "file") { await api.writeManuscriptFile(id, { path: value, content: "", expectedRevision: null }); acceptTree(await api.manuscript(id)); selectFile(value); setViewMode("source"); }
      else if (dialog === "folder") { acceptTree(await api.changeManuscriptTree(id, { action: "folder", path: value, expectedRevision: latest.treeRevision! })); setSelected(value); }
      else {
        const next = await api.changeManuscriptTree(id, { action: "move", path: selected, destination: value, expectedRevision: latest.treeRevision! });
        const renamed = (name: string) => name === selected || name.startsWith(`${selected}/`) ? value + name.slice(selected.length) : name;
        acceptTree(next); setView((current) => reconcileWritingView({ ...current, active: renamed(active), selected: value, openFiles: openFiles.map(renamed), collapsedFolders: current.collapsedFolders.map(renamed) }, next)); setHistory(null); setHistorical(null); setCandidateReview(null);
      }
    }} />}
  </div>;
}
