import { useEffect, useState } from "react";
import { FolderOpen, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import type { WritingContextSelection, WritingSourceCatalog } from "@litagent/contracts";
import { api } from "./api";
import { FileImportDialog } from "./FileImportDialog";

export function WritingSources({ manuscriptId, selected, onChange }: {
  manuscriptId: string; selected: WritingContextSelection; onChange: (value: WritingContextSelection) => void;
}) {
  const [catalog, setCatalog] = useState<WritingSourceCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [importMode, setImportMode] = useState<"files" | "local" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function refresh() { setCatalog(await api.writingSources(manuscriptId)); }
  useEffect(() => { let current = true; api.writingSources(manuscriptId).then((value) => { if (current) setCatalog(value); }).catch((error) => { if (current) setError(error.message); }); return () => { current = false; }; }, [manuscriptId]);
  const run = async (fn: () => Promise<void>) => { setPending(true); setError(null); try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : "Source action failed."); } finally { setPending(false); } };
  function toggle(field: keyof WritingContextSelection, id: string, checked: boolean) {
    const values = selected[field], limit = field === "paperIds" ? 12 : field === "attachmentIds" ? 40 : 20;
    if (checked && values.length >= limit) { setError(`Select at most ${limit} sources in this group.`); return; }
    onChange({ ...selected, [field]: checked ? [...values, id] : values.filter((item) => item !== id) });
  }
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const checkbox = (label: string, field: keyof WritingContextSelection, id: string, detail: string, disabled = false) => <label className="writing-source-option" key={id}>
    <input type="checkbox" checked={selected[field].includes(id)} disabled={pending || disabled} onChange={(event) => toggle(field, id, event.target.checked)} />
    <span>{label}<small>{detail}</small></span>
  </label>;
  return <div className="writing-source-picker">
    <div className="writing-source-upload"><button type="button" disabled={pending} onClick={() => setImportMode("files")}><Plus size={15} />Attach files</button><button type="button" disabled={pending} onClick={() => setImportMode("local")}><FolderOpen size={15} />Add workspace folder</button></div>
    <div className="writing-source-search"><Search size={15} /><input type="search" aria-label="Filter writing sources" placeholder="Filter sources" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" className="writing-tool" title="Refresh sources" aria-label="Refresh sources" disabled={pending} onClick={() => void run(refresh)}><RefreshCw size={15} /></button></div>
    {error && <p role="alert" className="writing-error">{error}</p>}
    {!catalog && <p role="status">Loading sources...</p>}
    {catalog && <>
      <section><h3>Literature <span>{selected.paperIds.length}/12</span></h3><small>{catalog.projectIds.length ? "Linked projects" : "Global library"}</small>
        {catalog.papers.filter((paper) => matches(paper.title)).map((paper) => checkbox(paper.title, "paperIds", paper.id, paper.converted ? `${paper.year ?? "Year unknown"} / Markdown` : "Markdown conversion required", !paper.converted))}
        {!catalog.papers.length && <p>No papers in this document's scope.</p>}
      </section>
      <section><h3>Manuscript <span>{selected.manuscriptPaths.length}/20</span></h3>
        {catalog.files.filter((file) => !/\.bib$/i.test(file.path) && matches(file.path)).map((file) => checkbox(file.path, "manuscriptPaths", file.path, `${file.characters.toLocaleString()} characters`))}
      </section>
      <section><h3>Internal sources <span>{selected.attachmentIds.length}/40</span></h3>
        {catalog.attachments.filter((source) => matches(source.path)).map((source) => <div className="writing-attachment-row" key={source.id}>{checkbox(source.path, "attachmentIds", source.id, `${source.kind} / ${source.revision.slice(0, 8)}`)}<button type="button" className="writing-tool" aria-label={`Remove source ${source.path}`} title="Remove source copy" disabled={pending} onClick={() => { if (window.confirm(`Remove the attached copy of ${source.path}? The original file is unchanged.`)) void run(async () => { await api.removeWritingSource(manuscriptId, source.id); onChange({ ...selected, attachmentIds: selected.attachmentIds.filter((id) => id !== source.id) }); await refresh(); }); }}><Trash2 size={14} /></button></div>)}
        {!catalog.attachments.length && <p>No internal sources attached.</p>}
      </section>
    </>}
    {importMode && <FileImportDialog kind="sources" manuscriptId={manuscriptId} initialMode={importMode} onImported={refresh} onClose={() => setImportMode(null)} />}
  </div>;
}
