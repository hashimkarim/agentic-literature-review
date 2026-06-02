import { FileText, Highlighter, MessageSquareText, PanelRightOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Passage, QaResponse } from "@litagent/contracts";
import { PdfReader, PdfUnavailable } from "@litagent/pdf";

import { API_BASE, type PaperEntry } from "../api";

export function ReaderPanel({
  paperEntry,
  markdown,
  passages,
  qa,
  tab,
  onTabChange
}: {
  paperEntry: PaperEntry | null;
  markdown: string | null;
  passages: Passage[];
  qa: QaResponse | null;
  tab: "pdf" | "markdown" | "notes";
  onTabChange: (tab: "pdf" | "markdown" | "notes") => void;
}) {
  const paper = paperEntry?.paper ?? null;
  const pdfHighlights = qa?.evidence.map((item) => ({
    page: item.page ?? 1,
    quote: item.quote,
    color: "green" as const
  })) ?? [];

  return (
    <section className="reader">
      <div className="reader-title">
        <div>
          <h1>{paper?.title ?? "Select a paper"}</h1>
          <span>{paper ? `${paper.authors.join(", ") || "Unknown authors"}${paper.year ? `, ${paper.year}` : ""}` : ""}</span>
        </div>
        <button type="button" className="icon-button" title="Open detail panel">
          <PanelRightOpen size={17} />
        </button>
      </div>
      <div className="reader-tabs">
        <button type="button" className={tab === "pdf" ? "active" : ""} onClick={() => onTabChange("pdf")}>
          <FileText size={15} />
          PDF
        </button>
        <button type="button" className={tab === "markdown" ? "active" : ""} onClick={() => onTabChange("markdown")}>
          <Highlighter size={15} />
          Markdown
        </button>
        <button type="button" className={tab === "notes" ? "active" : ""} onClick={() => onTabChange("notes")}>
          <MessageSquareText size={15} />
          Notes
        </button>
      </div>
      <div className="reader-content">
        {tab === "pdf" && paper ? (
          paper.filePaths.pdf ? (
            <PdfReader
              source={`${API_BASE}/api/papers/${paper.id}/pdf`}
              highlights={pdfHighlights}
            />
          ) : (
            <PdfUnavailable title={paper.title} />
          )
        ) : null}
        {tab === "markdown" ? (
          <article className="markdown-view">
            {markdown ? <ReactMarkdown>{markdown}</ReactMarkdown> : <p>No Markdown exists yet. Run Convert to create a reading copy.</p>}
          </article>
        ) : null}
        {tab === "notes" ? (
          <div className="notes-view">
            <section>
              <h2>Evidence Ledger</h2>
              {qa?.evidence.length ? (
                qa.evidence.map((item) => (
                  <a key={`${item.paperId}-${item.passageId}`} href={`#${item.passageId}`} className="evidence-line">
                    <b>p.{item.page ?? "?"}</b>
                    <span>{item.quote}</span>
                  </a>
                ))
              ) : (
                <p>Ask a cited question to populate the evidence ledger.</p>
              )}
            </section>
            <section>
              <h2>Indexed Passages</h2>
              {passages.slice(0, 8).map((passage) => (
                <p key={passage.id} id={passage.id} className="passage-note">
                  <b>{passage.section}</b>
                  <span>{passage.quote}</span>
                </p>
              ))}
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
