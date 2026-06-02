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
  onRunWorkflow,
  onAsk
}: {
  project: Project | null;
  providers: AgentProvider[];
  workflows: Array<{ id: string; label: string; status: string; createdAt: string }>;
  qa: QaResponse | null;
  passages: Passage[];
  selectedPaper: PaperEntry | null;
  onRunWorkflow: (type: WorkflowType, query?: string) => void;
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const installed = providers.filter((provider) => provider.installed);
  return (
    <aside className="agent-panel">
      <div className="agent-tabs">
        <button type="button" className="active">
          Agent
        </button>
        <button type="button">Evidence {passages.length}</button>
      </div>

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
                  <small>{new Date(run.createdAt).toLocaleTimeString()}</small>
                </span>
                <em className={`status-${run.status}`}>{run.status}</em>
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
            <span key={provider.id} className={provider.installed ? "provider-pill installed" : "provider-pill"}>
              {provider.label}
            </span>
          ))}
        </div>
        <p className="empty-copy">
          {installed.length ? `${installed.length} CLI provider(s) detected.` : "No CLI providers detected."}
        </p>
      </section>
    </aside>
  );
}
