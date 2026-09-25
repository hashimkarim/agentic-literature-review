import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FilePlus2, FolderOpen, HardDrive, LibraryBig, Search, Square, Upload, X } from "lucide-react";
import type { WritingAttachmentInput } from "@litagent/contracts";
import { api } from "./api";
import "./file-import.css";

type Entry = { id: string; path: string; bytes: number; file?: File; previewId?: string };
type Outcome = { id: string; path: string; state: "imported" | "error"; message?: string };
const sourceExtension = /\.(ts|tsx|js|jsx|py|rs|go|c|h|cpp|hpp|java|r|jl|sql|md|txt|csv|tsv|json|yaml|yml|toml|tex|bib)$/i;
const size = (bytes: number) => bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;

export function FileImportDialog({ kind, projectId = null, projectName, manuscriptId, onImported, onClose, initialMode = "files" }: {
  kind: "pdf" | "sources"; projectId?: string | null; projectName?: string | undefined; manuscriptId?: string;
  onImported: () => Promise<void>; onClose: () => void; initialMode?: "files" | "local" | "zotero";
}) {
  const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const stopped = useRef(false);
  const [mode, setMode] = useState(initialMode);
  const [folderPath, setFolderPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState(0), [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false), [stopRequested, setStopRequested] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [current, setCurrent] = useState("");
  const [sourceKind, setSourceKind] = useState<WritingAttachmentInput["kind"] | "auto">("auto");
  const [originUrl, setOriginUrl] = useState("");
  const pending = busy || scanning;
  const limit = kind === "sources" ? 100 : 2000;
  useEffect(() => { dialog.current?.showModal(); return () => { stopped.current = true; dialog.current?.close(); }; }, []);
  const visible = entries.filter((entry) => entry.path.toLowerCase().includes(query.toLowerCase()));
  const done = new Set(outcomes.filter((item) => item.state === "imported").map((item) => item.id));
  const todo = entries.filter((entry) => selected.includes(entry.id) && !done.has(entry.id));
  function replace(items: Entry[], omitted: number, bounded = false) {
    setEntries(items); setSelected(kind === "pdf" ? items.map((item) => item.id) : []); setSkipped(omitted); setTruncated(bounded); setOutcomes([]); setQuery(""); setError("");
  }
  function changeMode(next: typeof mode) {
    if (next !== mode) { replace([], 0); setMode(next); }
  }
  function chooseFiles(files: FileList | null) {
    const all = Array.from(files ?? []), items: Entry[] = [];
    for (const file of all) {
      const path = file.webkitRelativePath || file.name;
      if (path.split("/").some((part) => part.startsWith(".") || /^(node_modules|vendor|dist|build|out|target|__pycache__|venv|env|coverage|checkpoints)$/i.test(part) || /(^|[-_.])(secrets?|credentials?|passwords?|tokens?)([-_.]|$)/i.test(part))) continue;
      if (!(kind === "pdf" ? /\.pdf$/i : sourceExtension).test(path) || file.size < 1 || file.size > (kind === "pdf" ? 200_000_000 : 256_000)) continue;
      items.push({ id: crypto.randomUUID(), path, bytes: file.size, file });
    }
    replace(items.slice(0, 2000).sort((a, b) => a.path.localeCompare(b.path)), all.length - items.length, items.length > 2000);
  }
  async function scan() {
    replace([], 0); setScanning(true);
    try { const preview = await api.previewLocalFolder(folderPath, kind); replace(preview.files.map((entry) => ({ ...entry, previewId: preview.id })), preview.skipped, preview.truncated); setFolderPath(preview.root); }
    catch (error) { setError(error instanceof Error ? error.message : "Folder scan failed."); }
    finally { setScanning(false); }
  }
  async function importSelected() {
    if (!todo.length || todo.length > limit) return;
    setBusy(true); setError(""); stopped.current = false; setStopRequested(false);
    const results = outcomes.filter((item) => item.state === "imported");
    try {
      for (const entry of todo) {
        if (stopped.current) break;
        setCurrent(entry.path);
        try {
          if (entry.previewId) await api.importLocalEntry({ previewId: entry.previewId, entryId: entry.id, projectId, ...(manuscriptId ? { manuscriptId } : {}), originUrl: originUrl.trim() || null, ...(sourceKind === "auto" ? {} : { sourceKind }) });
          else if (entry.file && kind === "pdf") await api.importPaper({ file: entry.file, projectId });
          else if (entry.file && manuscriptId) {
            const inferred = /\.(csv|tsv|json)$/i.test(entry.path) ? "results" : /\.(md|txt|tex|bib)$/i.test(entry.path) ? "notes" : "code";
            await api.attachWritingSource(manuscriptId, { path: entry.path, kind: sourceKind === "auto" ? inferred : sourceKind, content: await entry.file.text(), originUrl: originUrl.trim() || null });
          } else throw new Error("No file selected.");
          results.push({ id: entry.id, path: entry.path, state: "imported" });
        } catch (error) { results.push({ id: entry.id, path: entry.path, state: "error", message: error instanceof Error ? error.message : "Import failed." }); }
        setOutcomes([...results]);
      }
      await onImported();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not refresh imported files."); }
    finally { setBusy(false); setCurrent(""); }
  }
  function toggleVisible(checked: boolean) {
    const ids = visible.map((entry) => entry.id);
    const next = checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id));
    if (next.length > limit) { setError(`Choose at most ${limit} files per import. Filter by folder or filename to narrow the selection.`); return; }
    setSelected(next); setError("");
  }
  return createPortal(<dialog ref={dialog} className="file-import-dialog" aria-label={kind === "pdf" ? "Import papers" : "Attach evidence sources"} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><h2>{kind === "pdf" ? "Import papers" : "Attach evidence sources"}</h2><button type="button" className="file-import-icon" aria-label="Close import" title="Close import" disabled={pending} onClick={onClose}><X size={18} /></button></header>
    <div className="file-import-destination"><LibraryBig size={16} /><span>{kind === "pdf" ? projectId ? `Global library + ${projectName ?? "selected project"}` : "Global library" : "Document source snapshots"}</span></div>
    <div className="file-import-tabs" role="tablist" aria-label="Import source">
      <button type="button" role="tab" aria-selected={mode === "files"} disabled={pending} onClick={() => changeMode("files")}><FilePlus2 size={16} />Files or folder</button>
      <button type="button" role="tab" aria-selected={mode === "local"} disabled={pending} onClick={() => changeMode("local")}><HardDrive size={16} />Local path</button>
      {kind === "pdf" && <button type="button" role="tab" aria-selected={mode === "zotero"} disabled={pending} onClick={() => changeMode("zotero")}><LibraryBig size={16} />Zotero PDFs</button>}
    </div>
    {mode === "files" ? <div className="file-import-pickers"><button type="button" disabled={pending} onClick={() => fileInput.current?.click()}><FilePlus2 size={16} />Choose files</button><button type="button" disabled={pending} onClick={() => folderInput.current?.click()}><FolderOpen size={16} />Choose folder</button></div> : <form className="file-import-path" onSubmit={(event) => { event.preventDefault(); void scan(); }}>
      <label>{mode === "zotero" ? "Zotero storage folder" : "Folder on this computer"}<input aria-label="Local folder path" value={folderPath} onChange={(event) => { setFolderPath(event.target.value); replace([], 0); }} placeholder={mode === "zotero" ? "/home/your-name/Zotero/storage" : "/absolute/path/to/folder"} disabled={pending} required autoFocus /></label>
      <button type="submit" disabled={pending || !folderPath.trim()}><Search size={16} />{scanning ? "Scanning..." : "Scan folder"}</button>
      {mode === "zotero" && <p className="file-import-note">Local PDF attachments only. Cloud-only and linked files outside this folder are not included. Zotero metadata sync is not connected.</p>}
    </form>}
    <input hidden type="file" ref={fileInput} multiple accept={kind === "pdf" ? ".pdf" : undefined} aria-label="Import selected files" onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <input hidden type="file" ref={folderInput} multiple {...{ webkitdirectory: "" }} aria-label="Import folder files" onChange={(event) => { chooseFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    {kind === "sources" && <label className="file-import-kind">Source type<select value={sourceKind} disabled={pending} onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}><option value="auto">From file type</option><option value="code">Code</option><option value="results">Experiment results</option><option value="notes">Research notes</option><option value="benchmark">Benchmark</option></select></label>}
    {kind === "sources" && <label className="file-import-kind">Original URL (optional)<input type="url" value={originUrl} maxLength={2000} placeholder="https://..." disabled={pending} onChange={(event) => setOriginUrl(event.target.value)} /></label>}
    {!!entries.length && <>
      <div className="file-import-search"><Search size={16} /><input type="search" aria-label="Filter import files" placeholder="Filter by folder or filename" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{selected.length} selected / {entries.length}</span></div>
      <label className="file-import-select-all"><input type="checkbox" aria-label="Select visible files" checked={visible.length > 0 && visible.every((entry) => selected.includes(entry.id))} disabled={pending} onChange={(event) => toggleVisible(event.target.checked)} />Select visible files<span>{size(entries.filter((entry) => selected.includes(entry.id)).reduce((total, entry) => total + entry.bytes, 0))}</span></label>
      <div className="file-import-list">{visible.map((entry) => { const result = outcomes.find((item) => item.id === entry.id); return <label key={entry.id} title={entry.path}><input type="checkbox" disabled={pending || done.has(entry.id)} checked={selected.includes(entry.id)} onChange={(event) => { if (event.target.checked && selected.length >= limit) { setError(`Select at most ${limit} files per import.`); return; } setSelected((items) => event.target.checked ? [...items, entry.id] : items.filter((id) => id !== entry.id)); }} /><span>{entry.path}{result?.state === "error" && <small role="alert">{result.message}</small>}</span><small>{result?.state === "imported" ? <Check size={16} aria-label="Imported" /> : size(entry.bytes)}</small></label>; })}</div>
    </>}
    {(skipped > 0 || truncated) && <p className="file-import-note">{skipped} unsupported, hidden, generated or oversized entries skipped.{truncated && " Preview limit reached. Choose a smaller subfolder for the remaining files."}</p>}
    {error && <p className="file-import-error" role="alert">{error}</p>}
    {(busy || outcomes.length > 0) && <div className="file-import-progress" role="status"><span>{outcomes.filter((item) => item.state === "imported").length} imported / {outcomes.filter((item) => item.state === "error").length} failed{stopRequested ? " / stopped" : ""}</span>{busy && <progress max={selected.length} value={outcomes.length} />}<small title={current}>{current}</small></div>}
    <footer>{busy ? <button type="button" disabled={stopRequested} onClick={() => { stopped.current = true; setStopRequested(true); }}><Square size={15} />{stopRequested ? "Stopping after current file..." : "Stop import"}</button> : <button type="button" disabled={scanning} onClick={onClose}>{outcomes.length ? "Done" : "Cancel"}</button>}<button type="button" className="file-import-primary" disabled={pending || !todo.length || todo.length > limit} onClick={() => void importSelected()}><Upload size={16} />{kind === "pdf" ? "Import" : "Attach"} {todo.length || "selected"} files</button></footer>
  </dialog>, document.body);
}
