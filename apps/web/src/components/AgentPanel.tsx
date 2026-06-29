import {
  BadgeCheck,
  Brain,
  ClipboardCheck,
  FileQuestion,
  GitCompare,
  ListChecks,
  Search,
  Tags,
  WandSparkles
} from "lucide-react";
import { useState } from "react";
import type { AgentProvider, Passage, Project, QaResponse, WorkflowType } from "@litagent/contracts";
import { workflowLabels } from "@litagent/ui";

import type { PaperEntry } from "../api";

const workflowCards: Array<{ type: WorkflowType; icon: typeof Tags }> = [
  { type: "relevance-tagging", icon: Tags },
  { type: "metadata-extraction", icon: ClipboardCheck },
  { type: "compare-papers", icon: GitCompare },
  { type: "ask-with-citations", icon: FileQuestion },
  { type: "find-papers", icon: Search },
  { type: "contradiction-finder", icon: Brain },
  { type: "screening", icon: ListChecks },
  { type: "synthesis-note", icon: WandSparkles }
];

export function AgentPanel({
  project,
  providers,
  workflows,
  qa,
  passages,
  selectedPaper,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
  onRunWorkflow,
  onCancelWorkflow,
  onAsk
}: {
  project: Project | null;
  providers: AgentProvider[];
  workflows: Array<{ id: string; label: string; status: string; createdAt: string; providerId: string; model: string | null }>;
  qa: QaResponse | null;
  passages: Passage[];
  selectedPaper: PaperEntry | null;
  selectedProviderId: string;
  selectedModel: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string | null) => void;
  onRunWorkflow: (type: WorkflowType, query?: string) => void;
  onCancelWorkflow: (runId: string) => void;
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const enabledProviders = providers.filter((provider) => provider.installed && provider.enabled);
  const selectableProviders = providers.filter((provider) => provider.id !== "local-heuristic");
  const selectedProvider = selectableProviders.find((provider) => provider.id === selectedProviderId) ?? null;
  return (
    <aside className="agent-panel">
      <div className="agent-tabs">
        <button type="button" className="active">
          Agent
        </button>
        <button type="button">Evidence {passages.length}</button>
      </div>

      <section className="panel-section">
        <h2>Provider</h2>
        <div className="agent-provider-controls">
          <select value={selectedProviderId} onChange={(event) => onProviderChange(event.currentTarget.value)}>
            {selectableProviders.map((provider) => (
              <option key={provider.id} value={provider.id} disabled={!provider.installed || !provider.enabled}>
                {provider.label}
                {!provider.installed ? " (missing)" : !provider.enabled ? " (disabled)" : ""}
              </option>
            ))}
          </select>
          <select value={selectedModel ?? ""} onChange={(event) => onModelChange(event.currentTarget.value || null)} disabled={!selectedProvider}>
            <option value="">CLI default</option>
            {selectedProvider?.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel-section">
        <h2>Workflows</h2>
        <div className="workflow-grid">
          {workflowCards.map((card) => {
            const Icon = card.icon;
            return (
              <button key={card.type} type="button" className="workflow-card" onClick={() => onRunWorkflow(card.type)}>
                <Icon size={17} />
                <span>{workflowLabels[card.type]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel-section cited-answer">
        <h2>
          Cited Answer
          <span className="verified-chip">
            <BadgeCheck size={14} />
            Verified
          </span>
        </h2>
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) onAsk(question.trim());
          }}
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            placeholder={`Ask ${selectedPaper ? "this paper" : project?.name ?? "the library"}...`}
          />
          <button type="submit">Ask</button>
        </form>
        {qa ? (
          <div className="answer-box">
            <p>{qa.answer.split("\n")[0]}</p>
            {qa.evidence.map((item, index) => (
              <a key={`${item.paperId}-${item.passageId}`} className="source-row" href={`#${item.passageId}`}>
                <b>{index + 1}</b>
                <span>{item.quote.slice(0, 110)}</span>
                <em>p.{item.page ?? "?"}</em>
              </a>
            ))}
          </div>
        ) : (
          <p className="empty-copy">Answers must cite indexed passages. If no source is found, LitAgent says so.</p>
        )}
      </section>

      <section className="panel-section">
        <h2>Workflow Queue</h2>
        <div className="queue-list">
          {workflows.length ? (
            workflows.map((run) => (
              <div key={run.id} className="queue-row">
                <span>
                  <b>{run.label}</b>
                  <small>
                    {new Date(run.createdAt).toLocaleTimeString()} · {run.providerId}
                    {run.model ? `/${run.model}` : ""}
                  </small>
                </span>
                <span className="queue-actions">
                  <em className={`status-${run.status}`}>{run.status}</em>
                  {run.status === "running" || run.status === "queued" ? (
                    <button type="button" onClick={() => onCancelWorkflow(run.id)}>
                      Cancel
                    </button>
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <p className="empty-copy">No workflow runs yet.</p>
          )}
        </div>
      </section>

      <section className="panel-section">
        <h2>Providers</h2>
        <div className="provider-list">
          {providers.map((provider) => (
            <span key={provider.id} className={provider.installed && provider.enabled ? "provider-pill installed" : "provider-pill"}>
              {provider.label}
            </span>
          ))}
        </div>
        <p className="empty-copy">
          {enabledProviders.length ? `${enabledProviders.length} enabled CLI provider(s).` : "No enabled CLI providers. Connect one in Settings."}
        </p>
      </section>
    </aside>
  );
}
