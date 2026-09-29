import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileText, Link2, Search, Square, Upload, X } from "lucide-react";
import type { PaperFolderPreview } from "@litagent/contracts";
import { api } from "./api";

type Outcome = { id: string; ok: boolean; message: string };
type Entry = PaperFolderPreview["entries"][number];

export function PaperFolderImport({ projectId, onImported, onClose, onPending }: {
  projectId: string | null; onImported: () => Promise<void>; onClose: () => void; onPending: (pending: boolean) => void;
}) {
  const [folder, setFolder] = useState(""), [markdownFolder, setMarkdownFolder] = useState("");
  const [storage, setStorage] = useState<"copy" | "linked-files">("linked-files");
  const [preview, setPreview] = useState<PaperFolderPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [matches, setMatches] = useState<Record<string, string | null>>({});
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [pairing, setPairing] = useState<string | null>(null), [pairQuery, setPairQuery] = useState("");
  const [scanning, setScanning] = useState(false), [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]), [current, setCurrent] = useState(""), [error, setError] = useState("");
  const stopped = useRef(false);
  const pending = busy || scanning;
  useEffect(() => { onPending(pending); }, [pending, onPending]);
  useEffect(() => () => { stopped.current = true; onPending(false); }, [onPending]);
  const entries = preview?.entries ?? [];
  const markdownOf = (entry: Entry) => preview?.markdownFiles.find((file) => file.id === (matches[entry.id] !== undefined ? matches[entry.id] : entry.markdown?.id)) ?? null;
  const category = (entry: Entry) => entry.pdf ? markdownOf(entry) ? "paired" : "pdf" : "markdown";
  const visible = entries.filter((entry) => (filter === "all" || category(entry) === filter) && `${entry.title} ${entry.pdf?.path ?? ""} ${markdownOf(entry)?.path ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const done = new Set(outcomes.filter((item) => item.ok).map((item) => item.id));
  const todo = entries.filter((entry) => selected.includes(entry.id) && !done.has(entry.id));
  const selectable = visible.filter((entry) => !done.has(entry.id));
  function resetPreview() { setPreview(null); setOutcomes([]); setSelected([]); setMatches({}); setError(""); setPairing(null); }
  async function scan() {
    resetPreview(); setScanning(true);
    try {
      const next = await api.previewPaperFolder(folder.trim(), markdownFolder.trim() || undefined);
      setPreview(next); setSelected(next.entries.filter((entry) => entry.pdf || !next.entries.some((item) => item.pdf)).map((entry) => entry.id));
      setQuery(""); setFilter("all");
    } catch (error) { setError(error instanceof Error ? error.message : "Folder scan failed."); }
    finally { setScanning(false); }
  }
  async function importSelected() {
    if (!preview || !todo.length) return;
    setBusy(true); setError(""); stopped.current = false; setStopping(false);
    const results = outcomes.filter((item) => item.ok);
    try {
      for (const entry of todo) {
        if (stopped.current) break;
        setCurrent(entry.title);
        try {
          const result = await api.importPaperFolderEntry({ previewId: preview.id, entryId: entry.id, markdownId: markdownOf(entry)?.id ?? null, storage, projectId });
          results.push({ id: entry.id, ok: true, message: result.warnings.join(" ") });
        } catch (error) { results.push({ id: entry.id, ok: false, message: error instanceof Error ? error.message : "Import failed." }); }
        setOutcomes([...results]);
      }
      await onImported();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not refresh the library."); }
    finally { setBusy(false); setCurrent(""); }
  }
  function chooseMarkdown(entry: Entry, id: string | null) {
    setMatches((items) => ({ ...items, [entry.id]: id })); setPairing(null);
    if (id) setSelected((ids) => ids.filter((selectedId) => selectedId === entry.id || !entries.some((item) => item.id === selectedId && !item.pdf && item.markdown?.id === id)));
  }
  return <>
    <div className="paper-import-storage" role="group" aria-label="File storage">
      <button type="button" aria-pressed={storage === "linked-files"} disabled={pending || !!outcomes.length} onClick={() => setStorage("linked-files")}><Link2 size={16} />Attach local files</button>
      <button type="button" aria-pressed={storage === "copy"} disabled={pending || !!outcomes.length} onClick={() => setStorage("copy")}><Copy size={16} />Import a copy</button>
    </div>
    <form className="paper-import-paths" onSubmit={(event) => { event.preventDefault(); void scan(); }}>
      <label>PDF / Markdown folder on the LitAgent server<input aria-label="Paper folder path" value={folder} onChange={(event) => { setFolder(event.target.value); resetPreview(); }} placeholder="/home/hashim/thesis-workspace/thesis-docs" disabled={pending} required autoFocus /></label>
      <details><summary>Separate Markdown folder</summary><label>Markdown folder (optional)<input aria-label="Markdown folder path" value={markdownFolder} onChange={(event) => { setMarkdownFolder(event.target.value); resetPreview(); }} placeholder="/absolute/path/to/markdown" disabled={pending} /></label></details>
      <button type="submit" disabled={pending || !folder.trim()}><Search size={16} />{scanning ? "Scanning..." : "Scan folder"}</button>
    </form>
    <p className="file-import-note">{storage === "linked-files" ? "Original files stay in place and remain read-only in LitAgent. External edits are reflected in the readers and search." : "PDFs, existing Markdown and referenced images are copied into the library. Later changes to the originals are not imported."}</p>
    {preview && <>
      <dl className="paper-import-roots"><div><dt>PDF / files</dt><dd>{preview.root}</dd></div>{preview.markdownRoot !== preview.root && <div><dt>Markdown</dt><dd>{preview.markdownRoot}</dd></div>}</dl>
      <div className="paper-import-filters" role="group" aria-label="Paper file types">{[["all", "All"], ["paired", "PDF + Markdown"], ["pdf", "PDF only"], ["markdown", "Markdown only"]].map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key!)}>{label}<span>{entries.filter((entry) => key === "all" || category(entry) === key).length}</span></button>)}</div>
      <div className="file-import-search"><Search size={16} /><input type="search" aria-label="Filter papers to import" placeholder="Filter by title or path" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{selected.length} selected</span></div>
      <label className="file-import-select-all"><input type="checkbox" aria-label="Select visible papers" disabled={pending || !selectable.length} checked={!!selectable.length && selectable.every((entry) => selected.includes(entry.id))} onChange={(event) => setSelected((ids) => event.target.checked ? [...new Set([...ids, ...selectable.map((entry) => entry.id)])] : ids.filter((id) => !selectable.some((entry) => entry.id === id)))} />Select visible papers</label>
      <div className="paper-import-list">{visible.map((entry) => {
        const md = markdownOf(entry), result = outcomes.find((item) => item.id === entry.id);
        return <div className="paper-import-entry" key={entry.id}>
          <label className="paper-import-title"><input type="checkbox" disabled={pending || done.has(entry.id)} checked={selected.includes(entry.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, entry.id] : ids.filter((id) => id !== entry.id))} /><span>{entry.title}</span>{result?.ok && <Check size={16} aria-label="Imported" />}</label>
          {entry.pdf && <div className="paper-import-file"><FileText size={14} /><b>PDF</b><span title={entry.pdf.path}>{entry.pdf.path}</span></div>}
          <div className="paper-import-file"><FileText size={14} /><b>MD</b><span title={md?.path}>{md?.path ?? "No Markdown matched"}</span>{entry.pdf && <button type="button" disabled={pending || done.has(entry.id)} aria-label={`Choose Markdown for ${entry.title}`} onClick={() => { setPairing(pairing === entry.id ? null : entry.id); setPairQuery(""); }}>{md ? "Change" : "Choose"}</button>}</div>
          {pairing === entry.id && <div className="paper-import-pairing">
            <div className="file-import-search"><input type="search" aria-label="Find matching Markdown" placeholder="Find Markdown by path" value={pairQuery} onChange={(event) => setPairQuery(event.target.value)} /><button type="button" className="file-import-icon" title="Close Markdown chooser" aria-label="Close Markdown chooser" onClick={() => setPairing(null)}><X size={15} /></button></div>
            <div className="paper-import-matches"><button type="button" onClick={() => chooseMarkdown(entry, null)}>No Markdown</button>{preview.markdownFiles.filter((file) => file.path.toLowerCase().includes(pairQuery.toLowerCase())).map((file) => <button type="button" key={file.id} onClick={() => chooseMarkdown(entry, file.id)}>{file.id === md?.id && <Check size={14} />}<span>{file.path}</span></button>)}</div>
          </div>}
          {result?.message && <p className={result.ok ? "file-import-note" : "file-import-error"} role={result.ok ? "status" : "alert"}>{result.message}</p>}
        </div>;
      })}{!visible.length && <p className="file-import-note">No matching papers.</p>}</div>
      {(preview.skipped > 0 || preview.truncated) && <p className="file-import-note">{preview.skipped} unsupported, hidden, generated or oversized entries skipped.{preview.truncated && " Preview limit reached. Select a smaller subfolder for the remaining files."}</p>}
    </>}
    {error && <p className="file-import-error" role="alert">{error}</p>}
    {(busy || outcomes.length > 0) && <div className="file-import-progress" role="status"><span>{outcomes.filter((item) => item.ok).length} imported / {outcomes.filter((item) => !item.ok).length} failed{stopping ? " / stopped" : ""}</span>{busy && <progress max={selected.length} value={outcomes.length} />}<small title={current}>{current}</small></div>}
    <footer>{busy ? <button type="button" disabled={stopping} onClick={() => { stopped.current = true; setStopping(true); }}><Square size={15} />{stopping ? "Stopping after current paper..." : "Stop import"}</button> : <button type="button" disabled={scanning} onClick={onClose}>{outcomes.length ? "Done" : "Cancel"}</button>}<button type="button" className="file-import-primary" disabled={pending || !todo.length} onClick={() => void importSelected()}>{storage === "linked-files" ? <Link2 size={16} /> : <Upload size={16} />}{storage === "linked-files" ? "Attach" : "Import"} {todo.length} {todo.length === 1 ? "paper" : "papers"}</button></footer>
  </>;
}
