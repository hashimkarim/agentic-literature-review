import { CheckCircle2, Circle, Filter, FolderTree, Plus, Tags } from "lucide-react";
import type { Project } from "@litagent/contracts";

import type { PaperEntry, ProjectDetails } from "../api";
import type { NavKey } from "./Sidebar";

export function ProjectPanel({
  activeNav,
  project,
  details,
  papers,
  projects,
  onProjectChange
}: {
  activeNav: NavKey;
  project: Project | null;
  details: ProjectDetails | null;
  papers: PaperEntry[];
  projects: Project[];
  onProjectChange: (projectId: string) => void;
}) {
  const tagCounts = new Map<string, number>();
  for (const entry of papers) {
    for (const tag of [...entry.paper.tags, ...(entry.link?.projectTags ?? [])]) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const included = papers.filter((entry) => entry.link?.relevanceState === "included").length;
  const maybe = papers.filter((entry) => entry.link?.relevanceState === "maybe").length;

  return (
    <aside className="project-panel">
      <div className="panel-heading">
        <span>{activeNav === "global" ? "Global Library" : project?.name ?? "No project"}</span>
        <button type="button" className="icon-button small" title="Add project or collection">
          <Plus size={15} />
        </button>
      </div>

      {activeNav !== "global" ? (
        <div className="project-selector-list">
          {projects.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={candidate.id === project?.id ? "project-chip active" : "project-chip"}
              onClick={() => onProjectChange(candidate.id)}
            >
              {candidate.id === project?.id ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              <span>{candidate.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <section className="panel-section">
        <h2>
          <FolderTree size={15} />
          Subcollections
        </h2>
        {details?.collections.length ? (
          details.collections.map((collection) => (
            <div className="collection-row" key={collection.id}>
              <span>{collection.name}</span>
              <b>{collection.paperIds.length}</b>
            </div>
          ))
        ) : (
          <p className="empty-copy">Global view shows every stored paper.</p>
        )}
      </section>

      <section className="panel-section">
        <h2>
          <Filter size={15} />
          Screening
        </h2>
        <div className="metric-grid">
          <div>
            <b>{papers.length}</b>
            <span>Total</span>
          </div>
          <div>
            <b>{included}</b>
            <span>Included</span>
          </div>
          <div>
            <b>{maybe}</b>
            <span>Maybe</span>
          </div>
        </div>
      </section>

      <section className="panel-section">
        <h2>
          <Tags size={15} />
          Tags
        </h2>
        <div className="tag-list">
          {[...tagCounts.entries()].slice(0, 12).map(([tag, count]) => (
            <span key={tag} className="tag-row">
              <span>{tag}</span>
              <b>{count}</b>
            </span>
          ))}
        </div>
      </section>

      {project?.researchQuestions.length ? (
        <section className="panel-section">
          <h2>Research Questions</h2>
          {project.researchQuestions.map((question) => (
            <p key={question.id} className="research-question">
              {question.text}
            </p>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
