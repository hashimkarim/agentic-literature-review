import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";
import { PdfReader } from "@litagent/pdf";
import type { TexBuild, TexBuildState, TexDiagnostic, TexSourceMap, ManuscriptCommentView, ManuscriptFile, CommentSelection } from "@litagent/contracts";
import { api } from "./api";
import { pdfCommentHighlights } from "./writing-pdf-comments";

export function useWritingBuild(manuscriptId: string) {
  const [state, setState] = useState<TexBuildState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const serial = useRef(0);
  const alive = useRef(false);
  const mutating = useRef(false);
  const polling = useRef(false);
  const actionFailed = useRef(false);
  async function refresh() {
    if (mutating.current || polling.current) return;
    polling.current = true;
    const ticket = ++serial.current;
    try {
      const next = await api.manuscriptBuilds(manuscriptId);
      if (alive.current && ticket === serial.current) { setState(next); if (!actionFailed.current) setError(null); }
    } catch (error) { if (alive.current && ticket === serial.current) setError(error instanceof Error ? error.message : "Build status unavailable."); }
    finally { polling.current = false; }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 1200);
    return () => { alive.current = false; serial.current++; clearInterval(timer); };
  }, [manuscriptId]);
  async function change(action: () => Promise<TexBuildState>) {
    if (mutating.current) return;
    mutating.current = true; actionFailed.current = false; serial.current++; setPending(true); setError(null);
    try { const next = await action(); if (alive.current) setState(next); }
    catch (error) { actionFailed.current = true; if (alive.current) setError(error instanceof Error ? error.message : "Build request failed."); }
    finally { mutating.current = false; if (alive.current) setPending(false); }
  }
  return { state, error, pending, refresh: () => { actionFailed.current = false; return refresh(); },
    compile: (save: () => Promise<Record<string, string>>, entryFile: string) => change(async () => api.compileManuscript(manuscriptId, { requestId: crypto.randomUUID(), entryFile, revisions: await save() })),
    cancel: () => change(async () => state?.latest ? api.cancelManuscriptBuild(manuscriptId, state.latest.id) : api.manuscriptBuilds(manuscriptId))
  };
}

export function WritingPreview({ manuscriptId, state, stale, onRefresh, comments, files, selectedComment, commentActivation, onComment, onSelectComment }: {
  manuscriptId: string; state: TexBuildState | null; stale: boolean; onRefresh: () => void;
  comments: ManuscriptCommentView[]; files: ManuscriptFile[]; selectedComment: string | null; commentActivation: number;
  onComment: (selection: CommentSelection) => void; onSelectComment: (id: string) => void;
}) {
  const pdf = state?.lastSuccessful;
  const [map, setMap] = useState<TexSourceMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; setMap(null); setMapError(null);
    if (pdf) void api.manuscriptSourceMap(manuscriptId, pdf.id).then((map) => { if (!cancelled) setMap(map); }, (error) => { if (!cancelled) setMapError(error instanceof Error ? error.message : "Source mapping unavailable."); });
    return () => { cancelled = true; };
  }, [manuscriptId, pdf?.id]);
  const highlights = useMemo(() => pdf && map && map.buildId === pdf.id && !stale ? pdfCommentHighlights(comments, files, pdf, map.boxes, selectedComment, commentActivation) : [], [comments, files, pdf, map, stale, selectedComment, commentActivation]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  async function download() {
    if (!pdf) return;
    setDownloading(true); setDownloadError(null);
    try {
      const response = await fetch(api.manuscriptPdfUrl(manuscriptId, pdf.id));
      if (!response.ok) throw new Error("Could not download this PDF. Refresh the build status and try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "manuscript.pdf"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "Download failed."); }
    finally { setDownloading(false); }
  }
  return <section className="writing-preview" aria-label="Compiled PDF preview">
    <header><FileText size={15} /><span>PDF preview</span>{pdf && <span className={stale ? "writing-preview-stale" : "writing-preview-current"}>{stale ? "Earlier revision" : "Up to date"}</span>}
      {pdf && <button type="button" className="writing-tool" disabled={downloading} onClick={() => void download()} title="Download compiled PDF" aria-label="Download compiled PDF"><Download size={16} /></button>}
    </header>
    {downloadError && <p className="writing-error" role="alert">{downloadError}</p>}
    {mapError && <p className="writing-pdf-comment-status" role="status">{mapError}</p>}
    {pdf ? <PdfReader key={pdf.id} source={api.manuscriptPdfUrl(manuscriptId, pdf.id)} readOnly highlights={highlights} onHighlightClick={onSelectComment}
      onCommentSelection={async (selection) => {
        if (stale) throw new Error("Compile your saved changes before commenting on this PDF.");
        if (!map) throw new Error(mapError ?? "Source map is loading. Try again.");
        const target = await api.manuscriptPdfSelection(manuscriptId, pdf.id, selection);
        onComment(target);
      }} /> : <div className="writing-preview-empty">
      <FileText size={28} /><p>{!state ? "Loading preview..." : !state.runtime.available ? state.runtime.message : state.latest?.status === "running" ? "Compiling..." : "No compiled PDF yet"}</p>
      {state && !state.runtime.available && <button type="button" onClick={onRefresh}><RefreshCw size={14} />Check runtime</button>}
    </div>}
  </section>;
}

export function WritingBuildLog({ build, onJump }: { build: TexBuild; onJump: (diagnostic: TexDiagnostic, build: TexBuild) => void }) {
  return <div className="writing-build-log" aria-label="Compilation output">
    <ol>{build.diagnostics.map((diagnostic, index) => <li key={index} className={`writing-diagnostic-${diagnostic.severity}`}>
      {diagnostic.path && diagnostic.line ? <button type="button" onClick={() => onJump(diagnostic, build)}><code>{diagnostic.path}:{diagnostic.line}</code><span>{diagnostic.message}</span></button> : <p>{diagnostic.message}</p>}
    </li>)}</ol>
    {build.log && <details><summary>Compiler log</summary><pre>{build.log}</pre></details>}
    {!build.diagnostics.length && !build.log && <p>{build.status === "running" ? "Compiling..." : "No diagnostics"}</p>}
  </div>;
}
