import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Eye, Files, ListChecks, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { AgentProvider, CreateWritingCandidates, ManuscriptFile, WritingAction, WritingAssistantOptions, WritingCandidateBatch, WritingContext, WritingContextSelection, WritingTarget } from "@litagent/contracts";
import { api } from "./api";
import { WritingSources } from "./WritingSources";
import type { WritingSelection } from "./WritingCandidates";
import type { WritingView } from "./writing-view";

const actions: Array<[WritingAction, string]> = [["draft", "Draft text"], ["outline", "Build an outline"], ["storyline", "Develop a storyline"], ["rewrite", "Rewrite"], ["expand", "Expand"], ["shorten", "Shorten"], ["simplify", "Simplify"], ["formalize", "Academic tone"], ["grammar", "Grammar and spelling"], ["citations", "Find supporting citations"], ["review", "Review argument and claims"]];
const audiences = ["Layperson", "Undergraduate", "Graduate", "Doctoral"];
const startsAtCursor = new Set<WritingAction>(["draft", "outline", "storyline", "review"]);
type Prepared = { request: CreateWritingCandidates; context: WritingContext; selection: WritingSelection };

export function WritingAssistant({ manuscriptId, file, selection, providers, visible, disabled, tab, setTab, capture, onClose, onCreated, drafts }: {
  manuscriptId: string; file: ManuscriptFile | undefined; selection: { from: number; to: number }; providers: AgentProvider[]; visible: boolean; disabled: boolean;
  tab: WritingView["assistantTab"]; setTab: (tab: WritingView["assistantTab"]) => void;
  capture: () => Promise<WritingSelection>; onClose: () => void; onCreated: (batch: WritingCandidateBatch) => void; drafts: ReactNode;
}) {
  const [action, setAction] = useState<WritingAction>("draft");
  const [instruction, setInstruction] = useState("");
  const [audience, setAudience] = useState(2);
  const [wordBudget, setWordBudget] = useState(250);
  const [jargon, setJargon] = useState<WritingAssistantOptions["jargon"]>("define");
  const [math, setMath] = useState<WritingAssistantOptions["math"]>("conceptual");
  const [language, setLanguage] = useState("English"), [style, setStyle] = useState("");
  const [sources, setSources] = useState<WritingContextSelection>({ paperIds: [], attachmentIds: [], manuscriptPaths: [] });
  const [targets, setTargets] = useState<WritingTarget[]>([{ providerId: "", model: "", count: 1 }]);
  const [preview, setPreview] = useState<Prepared | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const available = providers.filter((provider) => provider.id.startsWith("driver.") && provider.enabled && provider.connected);
  const total = targets.reduce((sum, target) => sum + target.count, 0);
  const selectedCount = sources.paperIds.length + sources.attachmentIds.length + sources.manuscriptPaths.length;
  const length = Math.max(0, selection.to - selection.from);
  const validTarget = targets.every((target) => available.find((provider) => provider.id === target.providerId)?.models.includes(target.model));
  const validFile = !!file?.path.endsWith(".tex") && length <= 8000 && (length > 0 || startsAtCursor.has(action));
  const updateTarget = (index: number, patch: Partial<WritingTarget>) => setTargets((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  const run = async (fn: () => Promise<void>) => { setPending(true); setError(null); try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : "Writing request failed."); } finally { setPending(false); } };
  async function prepare() {
    const captured = await capture();
    const context = await api.writingContext(manuscriptId, sources);
    const body = { path: captured.file.path, expectedRevision: captured.file.revision, from: captured.from, to: captured.to, instruction: instruction.trim(), audience, targets,
      assistant: { action, context: sources, expectedContextRevision: context.revision, wordBudget, jargon, math, language, style } };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, requestId: crypto.randomUUID() };
    setPreview({ request: { ...body, requestId: attempt.current.requestId }, context, selection: captured });
  }
  return <aside className="writing-assistant" aria-label="Writing assistant" hidden={!visible}>
    <header><Sparkles size={17} /><h2>AI assistant</h2><button type="button" className="writing-tool" title="Close writing assistant" aria-label="Close writing assistant" onClick={onClose}><X size={16} /></button></header>
    <div className="writing-assistant-tabs" role="tablist" aria-label="Assistant views">
      <button type="button" role="tab" aria-selected={tab === "compose"} onClick={() => setTab("compose")}><Sparkles size={14} />Compose</button>
      <button type="button" role="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}><Files size={14} />Sources {selectedCount > 0 && <span>{selectedCount}</span>}</button>
      <button type="button" role="tab" aria-selected={tab === "drafts"} onClick={() => setTab("drafts")}><ListChecks size={14} />Drafts</button>
    </div>
    {tab === "sources" ? <WritingSources manuscriptId={manuscriptId} selected={sources} onChange={setSources} /> : tab === "drafts" ? drafts : <form className="writing-assistant-compose" onSubmit={(event) => { event.preventDefault(); void run(prepare); }}><div className="writing-compose-fields">
      <div className="writing-assistant-target"><code title={file?.path}>{file?.path ?? "No text file"}</code><small>{length ? `${length.toLocaleString()} characters selected` : `Cursor / line ${file ? file.content.slice(0, selection.from).split("\n").length : 1}`}</small></div>
      <label>Task<select value={action} onChange={(event) => setAction(event.target.value as WritingAction)}>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Writing request<textarea aria-label="Writing request" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="What should this text accomplish?" rows={4} maxLength={2000} required /></label>
      <label className="writing-audience">Audience<output>{audiences[audience]}</output><input type="range" aria-label="Writing audience" min={0} max={3} step={1} value={audience} onChange={(event) => setAudience(Number(event.target.value))} /><span><span>Layperson</span><span>Doctoral</span></span></label>
      <details className="writing-preferences"><summary>Style and complexity</summary><div className="writing-preference-grid">
        <label>Target words<input type="number" min={30} max={2000} value={wordBudget} onChange={(event) => setWordBudget(Number(event.target.value))} required /></label>
        <label>Language<input value={language} maxLength={80} onChange={(event) => setLanguage(event.target.value)} required /></label>
        <label>Terminology<select value={jargon} onChange={(event) => setJargon(event.target.value as typeof jargon)}><option value="minimal">Minimal jargon</option><option value="define">Define terms</option><option value="specialist">Specialist</option></select></label>
        <label>Math detail<select value={math} onChange={(event) => setMath(event.target.value as typeof math)}><option value="conceptual">Conceptual</option><option value="equations">Equations</option><option value="derivation">Derivations</option></select></label>
      </div><label>Style constraints<textarea value={style} maxLength={2000} rows={2} onChange={(event) => setStyle(event.target.value)} /></label></details>
      <button type="button" className="writing-context-button" onClick={() => setTab("sources")}><Files size={15} />{selectedCount ? `${selectedCount} selected sources` : "Select evidence and context"}</button>
      <fieldset className="writing-targets" disabled={pending}><legend>Models and alternatives</legend>{targets.map((target, index) => <div className="writing-target" key={index}>
        <label>Connection<select aria-label={`Assistant connection ${index + 1}`} value={target.providerId} onChange={(event) => updateTarget(index, { providerId: event.target.value, model: "" })}><option value="">Select connection</option>{available.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
        <label>Model<select aria-label={`Assistant model ${index + 1}`} value={target.model} onChange={(event) => updateTarget(index, { model: event.target.value })}><option value="">Select model</option>{available.find((provider) => provider.id === target.providerId)?.models.map((model) => <option key={model}>{model}</option>)}</select></label>
        <label>Outputs<input type="number" aria-label={`Assistant outputs ${index + 1}`} min={1} max={3} value={target.count} onChange={(event) => updateTarget(index, { count: Math.min(3, Math.max(1, Number(event.target.value) || 1)) })} /></label>
        <button type="button" className="writing-tool" title="Remove model" aria-label={`Remove assistant model ${index + 1}`} disabled={targets.length === 1} onClick={() => setTargets((items) => items.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
      </div>)}<button type="button" disabled={targets.length >= 3 || total >= 6} onClick={() => setTargets((items) => [...items, { providerId: "", model: "", count: 1 }])}><Plus size={14} />Add model</button></fieldset>
      {!available.length && <p className="writing-error" role="alert">No enabled AgenticDriver connection. Configure one in Settings.</p>}
      {!validFile && <p className="writing-draft-notice">{!file?.path.endsWith(".tex") ? "Open a TeX file to write." : length > 8000 ? "Selection exceeds 8,000 characters." : "This task requires a text selection."}</p>}
      {total > 6 && <p className="writing-error">Choose at most six outputs.</p>}
      {error && !preview && <p className="writing-error" role="alert">{error}</p>}
      </div><footer><button type="submit" className="writing-primary" disabled={disabled || pending || !validFile || !validTarget || !instruction.trim() || total > 6}><Eye size={16} />{pending ? "Preparing..." : "Review context"}</button></footer>
    </form>}
    {preview && <WritingContextDialog prepared={preview} error={error} pending={pending} onClose={() => { if (!pending) { setPreview(null); setError(null); } }} onGenerate={() => void run(async () => { const batch = await api.createWritingCandidates(manuscriptId, preview.request); onCreated(batch); setPreview(null); setTab("drafts"); })} />}
  </aside>;
}

function WritingContextDialog({ prepared, pending, error, onClose, onGenerate }: { prepared: Prepared; pending: boolean; error: string | null; onClose: () => void; onGenerate: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  const { request, context, selection } = prepared;
  const total = request.targets.reduce((sum, target) => sum + target.count, 0);
  return <dialog ref={ref} className="writing-dialog writing-context-dialog" aria-label="Review writing context" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><Eye size={18} /><h2>Review context</h2><button type="button" className="writing-tool" title="Close context preview" aria-label="Close context preview" disabled={pending} onClick={onClose}><X size={16} /></button></header>
    <p><strong>{actions.find(([value]) => value === request.assistant?.action)?.[1]}</strong> / <code>{request.path}</code></p><p>{request.instruction}</p>
    <dl className="writing-context-summary"><dt>Audience</dt><dd>{audiences[request.audience]}</dd><dt>Sources</dt><dd>{context.coverage.length} / {context.characters.toLocaleString()} characters</dd><dt>Model calls</dt><dd>{total} drafts + {total} support reviews</dd></dl>
    <ul className="writing-coverage">{context.coverage.map((item) => <li key={item.sourceId}><span>{item.title}</span><strong className={item.status === "complete" ? "" : "writing-draft-notice"}>{item.status}</strong><small>{item.includedCharacters.toLocaleString()} / {item.totalCharacters.toLocaleString()} characters</small></li>)}</ul>
    {!context.sources.length && <p className="writing-draft-notice">No evidence selected. New factual claims cannot be supported.</p>}
    <details className="writing-sent-context"><summary>Selected text and surrounding context</summary><h3>Before</h3><pre>{selection.file.content.slice(Math.max(0, selection.from - 1500), selection.from) || "(none)"}</pre><h3>Selection</h3><pre>{selection.file.content.slice(selection.from, selection.to) || "(insert at cursor)"}</pre><h3>After</h3><pre>{selection.file.content.slice(selection.to, selection.to + 1500) || "(none)"}</pre></details>
    <details className="writing-sent-context"><summary>Source text sent to models</summary>{context.sources.map((source) => <section key={source.id}><h3>{source.title} / {source.kind} / lines {source.startLine}-{source.endLine}</h3><code>{source.revision.slice(0, 12)}</code><pre>{source.quote}</pre></section>)}</details>
    <details className="writing-sent-context"><summary>Models and preferences</summary><pre>{JSON.stringify({ targets: request.targets, audience: request.audience, ...request.assistant, context: undefined }, null, 2)}</pre></details>
    {error && <p role="alert" className="writing-error">{error}</p>}
    <footer><button type="button" disabled={pending} onClick={onClose}>Back</button><button type="button" className="writing-primary" disabled={pending} onClick={onGenerate}><Check size={16} />{pending ? "Starting..." : `Generate ${total} ${total === 1 ? "candidate" : "candidates"}`}</button></footer>
  </dialog>;
}
