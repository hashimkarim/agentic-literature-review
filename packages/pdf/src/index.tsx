import type { ReactNode } from "react";
import { CanvasLayer, Page, Pages, Root, TextLayer } from "@anaralabs/lector";
import "pdfjs-dist/web/pdf_viewer.css";

export interface PdfHighlight {
  page: number;
  quote: string;
  color?: "yellow" | "green" | "blue";
}

export interface PdfReaderProps {
  source: string;
  highlights?: PdfHighlight[];
  fallback?: ReactNode;
}

export function PdfReader({ source, highlights = [], fallback }: PdfReaderProps) {
  return (
    <div className="pdf-reader-shell">
      <Root source={source} loader={fallback ?? <div className="pdf-loading">Loading PDF...</div>}>
        <Pages className="pdf-pages">
          <Page>
            <CanvasLayer />
            <TextLayer />
          </Page>
        </Pages>
      </Root>
      {highlights.length > 0 ? (
        <div className="pdf-highlight-ledger" aria-label="PDF citation highlights">
          {highlights.map((highlight, index) => (
            <button key={`${highlight.page}-${index}`} type="button" className={`pdf-highlight pdf-${highlight.color ?? "yellow"}`}>
              p.{highlight.page} {highlight.quote.slice(0, 96)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PdfUnavailable({ title }: { title: string }) {
  return (
    <div className="pdf-unavailable">
      <strong>{title}</strong>
      <span>No PDF is attached to this paper yet.</span>
    </div>
  );
}
