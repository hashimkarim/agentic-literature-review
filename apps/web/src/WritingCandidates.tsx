import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { BookPlus, Check, Columns2, Copy, ExternalLink, FileText, Plus, Quote, RefreshCw, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import type { AgentProvider, ManuscriptFile, WritingCandidateBatch, WritingCandidateSummary, WritingSourceRef, WritingTarget } from "@litagent/contracts";
import { api, API_BASE } from "./api";

const PdfReader = lazy(async () => ({ default: (await import("@litagent/pdf")).PdfReader }));

export interface WritingSelection { file: ManuscriptFile; from: number; to: number }
const audiences = ["Layperson", "Undergraduate", "Graduate", "Doctoral / specialist"];

export function WritingCandidatesDialog({ manuscriptId, selection, providers, onClose, onCreated }: {
  manuscriptId: string; selection: WritingSelection; providers: AgentProvider[];
  onClose: () => void; onCreated: (batch: WritingCandidateBatch) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [instruction, setInstruction] = useState("Improve clarity while preserving the meaning and limitations.");
  const [audience, setAudience] = useState(2);
  const [targets, setTargets] = useState<WritingTarget[]>([{ providerId: "", model: "", count: 2 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const available = providers.filter((provider) => provider.id.startsWith("driver.") && provider.enabled && provider.connected);
  const total = targets.reduce((sum, target) => sum + target.count, 0);
  const valid = total <= 6 && instruction.trim() && targets.every((target) => available.find((provider) => provider.id === target.providerId)?.models.includes(target.model));
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const update = (index: number, patch: Partial<WritingTarget>) => setTargets((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!valid || busy) return;
    setBusy(true); setError(null);
    const body = { path: selection.file.path, expectedRevision: selection.file.revision, from: selection.from, to: selection.to, instruction, audience, targets };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const batch = await api.createWritingCandidates(manuscriptId, { ...body, requestId: attempt.current.requestId });
      onCreated(batch);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start generation."); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="writing-dialog writing-candidate-dialog" aria-labelledby="candidate-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><Sparkles size={18} /><h2 id="candidate-dialog-title">Generate alternatives</h2><button type="button" className="writing-tool" aria-label="Close generation" title="Close generation" disabled={busy} onClick={onClose}><X size={16} /></button></header>
      <div className="writing-candidate-scope"><code>{selection.file.path}</code><span>{selection.to - selection.from} selected characters</span></div>
      <label>Editing instruction<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={2000} rows={3} required disabled={busy} /></label>
      <label className="writing-audience">Audience<output>{audiences[audience]}</output><input aria-label="Audience" type="range" min={0} max={3} step={1} value={audience} onChange={(event) => setAudience(Number(event.target.value))} disabled={busy} /><span><span>Layperson</span><span>Doctoral / specialist</span></span></label>
      <fieldset disabled={busy} className="writing-targets"><legend>Models</legend>
        {targets.map((target, index) => <div className="writing-target" key={index}>
          <label>Connection<select aria-label={`Connection ${index + 1}`} value={target.providerId} onChange={(event) => update(index, { providerId: event.target.value, model: "" })}><option value="">Select connection</option>{available.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
          <label>Model<select aria-label={`Model ${index + 1}`} value={target.model} onChange={(event) => update(index, { model: event.target.value })}><option value="">Select model</option>{available.find((provider) => provider.id === target.providerId)?.models.map((model) => <option key={model}>{model}</option>)}</select></label>
          <label>Outputs<input aria-label={`Outputs ${index + 1}`} type="number" min={1} max={3} value={target.count} onChange={(event) => update(index, { count: Math.min(3, Math.max(1, Number(event.target.value) || 1)) })} /></label>
          <button type="button" className="writing-tool" aria-label={`Remove model ${index + 1}`} title="Remove model" disabled={targets.length === 1} onClick={() => setTargets((items) => items.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
        </div>)}
        <button type="button" disabled={targets.length === 3 || total >= 6} onClick={() => setTargets((items) => [...items, { providerId: "", model: "", count: 1 }])}><Plus size={15} />Add model</button>
      </fieldset>
      {!available.length && <p role="alert" className="writing-error">No enabled AgenticDriver connection. Configure one in Settings.</p>}
      {total > 6 && <p role="alert" className="writing-error">Choose at most six outputs.</p>}
      <details className="writing-sent-context"><summary>Context sent to models</summary><h3>Before selection</h3><pre>{selection.file.content.slice(Math.max(0, selection.from - 1500), selection.from) || "(none)"}</pre><h3>Selected text</h3><pre>{selection.file.content.slice(selection.from, selection.to)}</pre><h3>After selection</h3><pre>{selection.file.content.slice(selection.to, selection.to + 1500) || "(none)"}</pre></details>
      <p className="writing-draft-notice">Manuscript text only. Sources not verified.</p>
      {error && <p role="alert" className="writing-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="writing-primary" disabled={busy || !valid}><Sparkles size={16} />{busy ? "Starting..." : `Generate ${total} ${total === 1 ? "alternative" : "alternatives"}`}</button></footer>
    </form>
  </dialog>;
}

export function WritingCandidatesPanel({ manuscriptId, file, initialBatchId, busy, onCompare, onClearComparison, onAccept, onClose, bibliographyPaths = [], onReferences }: {
  manuscriptId: string; file: ManuscriptFile; initialBatchId: string | null; busy: boolean;
  onCompare: (batch: WritingCandidateBatch, candidateId: string) => void;
  onClearComparison: () => void;
  onAccept: (batch: WritingCandidateBatch, candidateId: string) => Promise<void>; onClose: () => void;
  bibliographyPaths?: string[]; onReferences?: (batch: WritingCandidateBatch, candidateId: string, path: string) => Promise<void>;
}) {
  const [summaries, setSummaries] = useState<WritingCandidateSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialBatchId);
  const [batch, setBatch] = useState<WritingCandidateBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [evidence, setEvidence] = useState<WritingSourceRef | null>(null);
  const [bibPath, setBibPath] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { if (!bibliographyPaths.includes(bibPath)) setBibPath(bibliographyPaths[0] ?? ""); }, [bibliographyPaths.join("\n"), bibPath]);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    api.writingCandidates(manuscriptId).then((items) => {
      if (!current) return;
      const filtered = items.filter((item) => item.path === file.path);
      setSummaries(filtered); setActiveId((id) => filtered.some((item) => item.id === id) ? id : filtered[0]?.id ?? null);
      setLoading(false);
    }).catch((error) => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; };
  }, [manuscriptId, file.path, refresh]);
  useEffect(() => { if (initialBatchId) { setActiveId(initialBatchId); setRefresh((n) => n + 1); } }, [initialBatchId]);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBatch(null);
    if (!activeId) return;
    const load = async () => {
      try {
        const next = await api.writingCandidate(manuscriptId, activeId);
        if (!current) return;
        setBatch(next); setError(null);
        if (next.status === "running") timer = setTimeout(() => void load(), 800);
      } catch (error) { if (current) setError(error instanceof Error ? error.message : "Could not refresh candidates."); }
    };
    void load();
    return () => { current = false; clearTimeout(timer); };
  }, [manuscriptId, activeId, refresh]);
  const action = async (fn: () => Promise<void>) => {
    setPending(true); setError(null); setNotice("");
    try { await fn(); setRefresh((n) => n + 1); } catch (error) { setError(error instanceof Error ? error.message : "Candidate action failed."); } finally { setPending(false); }
  };
  return <aside className="writing-candidates" aria-label="Writing alternatives" data-batch-id={batch?.id}>
    <header><h2>Alternatives</h2><button type="button" className="writing-tool" aria-label="Refresh alternatives" title="Refresh alternatives" onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={15} /></button><button type="button" className="writing-tool" aria-label="Close alternatives" title="Close alternatives" onClick={onClose}><X size={16} /></button></header>
    <div className="writing-candidate-batch-picker"><select aria-label="Generation batch" value={activeId ?? ""} disabled={pending || !summaries.length} onChange={(event) => { onClearComparison(); setActiveId(event.target.value); }}>{!summaries.length && <option value="">{loading ? "Loading..." : "No alternatives"}</option>}{summaries.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} - {item.instruction}</option>)}</select></div>
    {error && <p role="alert" className="writing-error">{error}</p>}
    {notice && <p className="writing-action-notice" role="status">{notice}</p>}
    {batch && <>
      <div className="writing-candidate-context"><span className="writing-draft-notice">{batch.accepted ? "Selection accepted" : batch.request.assistant ? "Drafts for review" : "Unverified drafts"}</span><span role="status">{batch.status}</span><p>{batch.request.instruction}</p><small>{audiences[batch.request.audience]} / {batch.request.expectedRevision.slice(0, 8)}</small>
        {batch.status === "running" && <button type="button" disabled={pending} onClick={() => void action(async () => { await api.cancelWritingCandidates(manuscriptId, batch.id); })}><Square size={13} />Stop generation</button>}
        {!batch.accepted && file.revision !== batch.request.expectedRevision && <p className="writing-error">Source changed. These alternatives cannot replace the current draft.</p>}
        {batch.sourceIssue && <p className="writing-error">{batch.sourceIssue}</p>}
      </div>
      <ol>{batch.candidates.map((candidate, index) => <li key={candidate.id} data-candidate-id={candidate.id}>
        <header><strong>Candidate {index + 1}</strong><span>{batch.accepted?.candidateId === candidate.id ? "accepted" : candidate.dismissed ? "rejected" : candidate.status === "running" ? candidate.phase ?? "running" : candidate.status}</span></header>
        <div className="writing-candidate-model" title={`${candidate.providerId} / ${candidate.model}`}>{candidate.model}<small>{candidate.providerId} / output {candidate.variant}</small></div>
        {candidate.text !== null && <><p className="writing-candidate-excerpt">{candidate.text}</p><details className="writing-candidate-text"><summary>Full text</summary><pre>{candidate.text}</pre><button type="button" onClick={() => void action(() => navigator.clipboard.writeText(candidate.text!))}><Copy size={14} />Copy text</button></details></>}
        {candidate.error && <p className="writing-error">{candidate.error}</p>}
        {candidate.review && <details className={`writing-candidate-review ${candidate.review.supported ? "supported" : "unsupported"}`}><summary>{candidate.review.supported ? "Model support review passed" : "Support review failed"}</summary><p>{candidate.review.reason}</p>{candidate.review.claims.map((claim) => <p key={claim.index}>Claim {claim.index + 1}: {claim.reason}</p>)}</details>}
        {candidate.editorial && <details className="writing-candidate-review"><summary>Editing checks</summary><p>{candidate.editorial.wordCount} estimated prose words / target {candidate.editorial.targetWords}</p><small>TeX prose estimate; citations and math excluded. Length and style notices are advisory.</small>{candidate.editorial.notices.map((notice) => <p key={notice}>{notice}</p>)}</details>}
        {candidate.warnings?.map((warning, i) => <p className="writing-draft-notice" key={i}>{warning}</p>)}
        {!!candidate.claims?.length && <details className="writing-candidate-evidence"><summary>Evidence ({candidate.claims.length} claims)</summary>{candidate.claims.map((claim, i) => <section key={i}><p>{claim.text} {claim.kind === "inference" && <em>(inference)</em>}</p>{claim.evidence.map((ref, j) => { const source = batch.context?.sources.find((item) => item.id === ref.sourceId); return <button type="button" key={j} aria-label={`Inspect evidence ${index + 1}.${i + 1}.${j + 1}`} disabled={pending || !!batch.sourceIssue} onClick={() => void action(async () => setEvidence(await api.writingEvidence(manuscriptId, batch.id, ref.sourceId, ref.quote)))}><Quote size={14} /><span>{source?.title ?? "Source"}<small>{ref.quote}</small></span></button>; })}</section>)}</details>}
        {onReferences && candidate.claims?.some((claim) => claim.evidence.some((ref) => batch.context?.sources.some((source) => source.id === ref.sourceId && source.kind === "literature"))) && <div className="writing-reference-action">
          <label>Bibliography<select aria-label={`Bibliography for candidate ${index + 1}`} value={bibPath} onChange={(event) => setBibPath(event.target.value)}>{!bibliographyPaths.length && <option value="">No bibliography file</option>}{bibliographyPaths.map((name) => <option key={name}>{name}</option>)}</select></label>
          <button type="button" disabled={!bibPath || busy || pending || !!batch.sourceIssue || !!batch.accepted} aria-label={`Add references for candidate ${index + 1}`} onClick={() => void action(async () => { await onReferences(batch, candidate.id, bibPath); setNotice(`References added to ${bibPath}.`); })}><BookPlus size={14} />Add references</button>
          {!bibPath && <p className="writing-draft-notice">Create a .bib file and include it in your TeX project before inserting cited text.</p>}
        </div>}
        {candidate.status === "completed" && <footer><button type="button" disabled={busy || pending} aria-label={`Compare candidate ${index + 1}`} onClick={() => onCompare(batch, candidate.id)}><Columns2 size={14} />Compare</button>
          {batch.request.assistant?.action !== "review" && <button type="button" disabled={busy || pending || batch.status === "running" || !!batch.accepted || !!candidate.dismissed || !!batch.sourceIssue || !!batch.request.assistant && !candidate.review?.supported || file.revision !== batch.request.expectedRevision} aria-label={`Accept candidate ${index + 1}`} onClick={() => void action(() => onAccept(batch, candidate.id))}><Check size={14} />Accept</button>}
          <button type="button" className="writing-tool" disabled={pending || batch.status === "running" || !!batch.accepted} aria-label={`${candidate.dismissed ? "Restore" : "Reject"} candidate ${index + 1}`} title={candidate.dismissed ? "Restore candidate" : "Reject candidate"} onClick={() => void action(async () => { await api.dismissWritingCandidate(manuscriptId, batch.id, candidate.id, !candidate.dismissed); })}>{candidate.dismissed ? <RotateCcw size={14} /> : <X size={14} />}</button>
        </footer>}
      </li>)}</ol>
    </>}
    {!loading && !summaries.length && <p className="writing-no-drafts">No saved candidates for {file.path}.</p>}
    {evidence && <WritingEvidenceDialog source={evidence} onClose={() => setEvidence(null)} />}
  </aside>;
}

function WritingEvidenceDialog({ source, onClose }: { source: WritingSourceRef; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pdf, setPdf] = useState(false);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={`writing-dialog writing-evidence-dialog${pdf ? " has-pdf" : ""}`} aria-label="Writing evidence" onCancel={onClose}>
    <header><Quote size={18} /><h2>Supporting evidence</h2><button type="button" className="writing-tool" aria-label="Close writing evidence" title="Close evidence" onClick={onClose}><X size={16} /></button></header>
    <h3>{source.title}</h3><p>{source.kind} / lines {source.startLine}-{source.endLine}{source.page ? ` / page ${source.page}` : ""}</p><code>Revision {source.revision.slice(0, 12)}</code>
    <blockquote>{source.quote}</blockquote>
    <div className="writing-evidence-links">{source.paperId && <><button type="button" onClick={() => setPdf((value) => !value)}><FileText size={15} />{pdf ? "Hide PDF" : "Open PDF"}</button><a href={`${API_BASE}/api/papers/${encodeURIComponent(source.paperId)}/markdown`} target="_blank" rel="noreferrer"><ExternalLink size={14} />Markdown source</a></>}{source.originUrl && <a href={source.originUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Original source</a>}</div>
    {pdf && source.paperId && <Suspense fallback={<p>Loading PDF...</p>}><PdfReader readOnly source={`${API_BASE}/api/papers/${encodeURIComponent(source.paperId)}/pdf`} highlights={[{ id: source.id, page: source.page ?? 1, quote: source.quote, active: true }]} /></Suspense>}
  </dialog>;
}
