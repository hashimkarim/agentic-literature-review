import { FileText, RefreshCw, Star } from "lucide-react";

import type { PaperEntry } from "../api";

export function PaperList({
  papers,
  selectedPaperId,
  onSelectPaper,
  onConvertSelected
}: {
  papers: PaperEntry[];
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string) => void;
  onConvertSelected: () => void;
}) {
  return (
    <section className="paper-list">
      <div className="paper-list-header">
        <div>
          <h1>All Papers</h1>
          <span>{papers.length} papers</span>
        </div>
        <button type="button" className="toolbar-button compact" onClick={onConvertSelected}>
          <RefreshCw size={15} />
          <span>Convert</span>
        </button>
      </div>
      <div className="paper-scroll">
        {papers.map(({ paper, link }) => (
          <button
            key={paper.id}
            type="button"
            className={paper.id === selectedPaperId ? "paper-row active" : "paper-row"}
            onClick={() => onSelectPaper(paper.id)}
          >
            <FileText size={18} />
            <span className="paper-row-main">
              <strong>{paper.title}</strong>
              <small>
                {paper.authors.join(", ") || "Unknown authors"}
                {paper.year ? `, ${paper.year}` : ""}
              </small>
              <span className="paper-tags">
                {[...(link?.projectTags ?? []), ...paper.tags].slice(0, 4).map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
            </span>
            <Star size={15} className={link?.relevanceState === "included" ? "star-on" : "muted-icon"} />
          </button>
        ))}
      </div>
    </section>
  );
}
