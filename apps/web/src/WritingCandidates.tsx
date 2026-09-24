import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Columns2, Plus, RefreshCw, Sparkles, Square, Trash2, X } from "lucide-react";
import type { AgentProvider, ManuscriptFile, WritingCandidateBatch, WritingCandidateSummary, WritingTarget } from "@litagent/contracts";
import { api } from "./api";

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

export function WritingCandidatesPanel({ manuscriptId, file, initialBatchId, busy, onCompare, onClearComparison, onAccept, onClose }: {
  manuscriptId: string; file: ManuscriptFile; initialBatchId: string | null; busy: boolean;
  onCompare: (batch: WritingCandidateBatch, candidateId: string) => void;
  onClearComparison: () => void;
  onAccept: (batch: WritingCandidateBatch, candidateId: string) => Promise<void>; onClose: () => void;
}) {
  const [summaries, setSummaries] = useState<WritingCandidateSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialBatchId);
  const [batch, setBatch] = useState<WritingCandidateBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
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
    setPending(true); setError(null);
    try { await fn(); setRefresh((n) => n + 1); } catch (error) { setError(error instanceof Error ? error.message : "Candidate action failed."); } finally { setPending(false); }
  };
  return <aside className="writing-candidates" aria-label="Writing alternatives" data-batch-id={batch?.id}>
    <header><h2>Alternatives</h2><button type="button" className="writing-tool" aria-label="Refresh alternatives" title="Refresh alternatives" onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={15} /></button><button type="button" className="writing-tool" aria-label="Close alternatives" title="Close alternatives" onClick={onClose}><X size={16} /></button></header>
    <div className="writing-candidate-batch-picker"><select aria-label="Generation batch" value={activeId ?? ""} disabled={pending || !summaries.length} onChange={(event) => { onClearComparison(); setActiveId(event.target.value); }}>{!summaries.length && <option value="">{loading ? "Loading..." : "No alternatives"}</option>}{summaries.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} - {item.instruction}</option>)}</select></div>
    {error && <p role="alert" className="writing-error">{error}</p>}
    {batch && <>
      <div className="writing-candidate-context"><span className="writing-draft-notice">{batch.accepted ? "Selection accepted" : "Unverified drafts"}</span><span role="status">{batch.status}</span><p>{batch.request.instruction}</p><small>{audiences[batch.request.audience]} / {batch.request.expectedRevision.slice(0, 8)}</small>
        {batch.status === "running" && <button type="button" disabled={pending} onClick={() => void action(async () => { await api.cancelWritingCandidates(manuscriptId, batch.id); })}><Square size={13} />Stop generation</button>}
        {!batch.accepted && file.revision !== batch.request.expectedRevision && <p className="writing-error">Source changed. These alternatives cannot replace the current draft.</p>}
      </div>
      <ol>{batch.candidates.map((candidate, index) => <li key={candidate.id}>
        <header><strong>Candidate {index + 1}</strong><span>{batch.accepted?.candidateId === candidate.id ? "accepted" : candidate.status}</span></header>
        <div className="writing-candidate-model" title={`${candidate.providerId} / ${candidate.model}`}>{candidate.model}<small>{candidate.providerId} / output {candidate.variant}</small></div>
        {candidate.text !== null && <p className="writing-candidate-excerpt">{candidate.text}</p>}
        {candidate.error && <p className="writing-error">{candidate.error}</p>}
        {candidate.status === "completed" && <footer><button type="button" disabled={busy || pending} aria-label={`Compare candidate ${index + 1}`} onClick={() => onCompare(batch, candidate.id)}><Columns2 size={14} />Compare</button><button type="button" disabled={busy || pending || batch.status === "running" || !!batch.accepted || file.revision !== batch.request.expectedRevision} aria-label={`Accept candidate ${index + 1}`} onClick={() => void action(() => onAccept(batch, candidate.id))}><Check size={14} />Accept</button></footer>}
      </li>)}</ol>
    </>}
  </aside>;
}
