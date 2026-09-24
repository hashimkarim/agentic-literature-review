import { useEffect, useRef, useState, type FormEvent } from "react";
import { FileArchive, FolderOpen, Upload, X, AlertTriangle, FileCode2, Image, CheckCircle2 } from "lucide-react";
import { zip } from "fflate";
import type { ManuscriptDocument, ManuscriptImportPreview, Project } from "@litagent/contracts";
import { api } from "./api";

async function folderArchive(files: File[]) {
  const contents: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0, omitted = 0;
  // Do not read hidden files (including Git and credentials) into browser memory.
  const visible = files.filter((file) => {
    const hidden = file.webkitRelativePath.split("/").some((part) => part.startsWith(".") || part === "node_modules" || part === "__MACOSX");
    if (hidden) omitted++; return !hidden;
  });
  if (visible.length > 4096) throw new Error("Folder contains more than 4096 files.");
  const tex = new Set(visible.filter((file) => /\.tex$/i.test(file.name)).map((file) => file.webkitRelativePath.slice(0, -4).toLowerCase()));
  for (const file of visible) {
    const generated = /\.(aux|log|toc|out|bcf|blg|fls|fdb_latexmk|synctex(?:\.gz)?|run\.xml|acn|acr|alg|glg|glo|gls|ist|lol|lof|lot|xdv)$/i.test(file.name) || (/\.pdf$/i.test(file.name) && tex.has(file.webkitRelativePath.slice(0, -4).toLowerCase()));
    if (generated) { contents[file.webkitRelativePath] = new Uint8Array(); continue; }
    bytes += file.size;
    if (bytes > 128 * 1024 * 1024) throw new Error("Folder files exceed the 128 MB upload limit.");
    contents[file.webkitRelativePath] = new Uint8Array(await file.arrayBuffer());
  }
  const packed = await new Promise<Uint8Array>((resolve, reject) => zip(contents, { level: 0 }, (error, data) => error ? reject(error) : resolve(data)));
  return { archive: new Blob([new Uint8Array(packed)], { type: "application/zip" }), omitted };
}

export function WritingImport({ projects, onImported, onClose }: { projects: Project[]; onImported: (document: ManuscriptDocument) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const [archive, setArchive] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<ManuscriptImportPreview | null>(null);
  const [name, setName] = useState("");
  const [entry, setEntry] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [omitted, setOmitted] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef({ id: crypto.randomUUID(), signature: "" });
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function choose(files: File[], isFolder: boolean) {
    if (!files.length) return;
    setBusy("Reading files..."); setError(null); setPreview(null); setArchive(null);
    request.current = { id: crypto.randomUUID(), signature: "" };
    try {
      const packed = isFolder ? await folderArchive(files) : { archive: files[0]!, omitted: 0 };
      if (packed.archive.size > 128 * 1024 * 1024) throw new Error("ZIP exceeds 128 MB.");
      setBusy("Checking project...");
      const result = await api.previewManuscriptImport(packed.archive);
      setArchive(packed.archive); setPreview(result); setOmitted(packed.omitted); setEntry(result.suggestedEntry ?? "");
      setName((isFolder ? files[0]!.webkitRelativePath.split("/")[0]! : files[0]!.name.replace(/\.zip$/i, "")).slice(0, 160));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not inspect import."); }
    finally { setBusy(null); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!archive || !entry) return;
    setBusy("Importing..."); setError(null);
    const signature = JSON.stringify({ name, entry, projectIds });
    if (request.current.signature && request.current.signature !== signature) request.current.id = crypto.randomUUID();
    request.current.signature = signature;
    try { onImported(await api.importManuscript(archive, { requestId: request.current.id, name, entryFile: entry, projectIds })); }
    catch (error) { setError(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(null); }
  }
  return <dialog ref={dialog} className="writing-dialog writing-import-dialog" aria-labelledby="writing-import-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><h2 id="writing-import-title">Import document</h2><button type="button" className="writing-tool" aria-label="Close import" title="Close import" disabled={!!busy} onClick={onClose}><X size={16} /></button></header>
      <div className="writing-import-pickers"><button type="button" disabled={!!busy} onClick={() => folder.current?.click()}><FolderOpen size={17} />Choose folder</button><button type="button" disabled={!!busy} onClick={() => zipInput.current?.click()}><FileArchive size={17} />Overleaf ZIP</button></div>
      <input ref={folder} hidden type="file" aria-label="Import document folder" {...{ webkitdirectory: "" }} multiple onChange={(event) => { void choose(Array.from(event.target.files ?? []), true); event.target.value = ""; }} />
      <input ref={zipInput} hidden type="file" aria-label="Import Overleaf ZIP" accept=".zip,application/zip" onChange={(event) => { void choose(Array.from(event.target.files ?? []), false); event.target.value = ""; }} />
      {busy && <p role="status">{busy}</p>}
      {error && <p className="writing-error" role="alert">{error}</p>}
      {preview && <>
        <div className="writing-import-fields"><label>Title<input required maxLength={160} value={name} disabled={!!busy} onChange={(event) => setName(event.target.value)} /></label>
          <label>Main TeX file<select required aria-label="Imported main TeX file" disabled={!!busy} value={entry} onChange={(event) => setEntry(event.target.value)}><option value="">Choose main file</option>{preview.entryCandidates.map((path) => <option key={path}>{path}</option>)}</select></label></div>
        {!!projects.length && <details className="writing-import-projects"><summary>Linked projects ({projectIds.length})</summary>{projects.map((project) => <label key={project.id}><input type="checkbox" disabled={!!busy} checked={projectIds.includes(project.id)} onChange={(event) => setProjectIds((ids) => event.target.checked ? [...ids, project.id] : ids.filter((id) => id !== project.id))} /><span>{project.name}</span></label>)}</details>}
        <div className="writing-import-summary">{preview.files.length} files <span>{preview.folders.length} folders</span><span>{(preview.files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(1)} MB</span></div>
        <ul className="writing-import-files" aria-label="Files to import">{preview.files.map((file) => <li key={file.path}>{file.kind === "source" ? <FileCode2 size={14} /> : <Image size={14} />}<span>{file.path}</span><small>{Math.max(1, Math.ceil(file.bytes / 1024))} KB</small></li>)}</ul>
        {preview.compiler?.available && <p className="writing-import-runtime"><CheckCircle2 size={16} /><span>{preview.compiler.message}</span></p>}
        {!!preview.warnings.length && <section className="writing-import-warnings" aria-label="Compilation compatibility"><h3><AlertTriangle size={15} />Build notes</h3><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>}
        {(preview.skipped.length > 0 || omitted > 0) && <details className="writing-import-skipped"><summary>Not imported ({preview.skipped.length + omitted})</summary>{omitted > 0 && <p>{omitted} hidden or dependency files excluded before upload</p>}<ul>{preview.skipped.map((file) => <li key={file.path}><span>{file.path}</span><small>{file.reason}</small></li>)}</ul></details>}
      </>}
      <footer><button type="button" disabled={!!busy} onClick={onClose}>Cancel</button><button type="submit" className="writing-primary" disabled={!!busy || !preview || !entry || !name.trim()}><Upload size={15} />Import document</button></footer>
    </form>
  </dialog>;
}
