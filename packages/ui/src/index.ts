export const appTokens = {
  color: {
    background: "#f7f8fa",
    surface: "#ffffff",
    surfaceMuted: "#f1f4f7",
    border: "#d9e0e7",
    borderStrong: "#bac5d0",
    text: "#17202a",
    muted: "#5c6977",
    faint: "#8793a0",
    active: "#2563eb",
    verified: "#16845b",
    pending: "#b7791f",
    danger: "#c24135"
  },
  radius: {
    sm: "4px",
    md: "6px",
    lg: "8px"
  },
  shadow: {
    panel: "0 1px 2px rgba(16, 24, 40, 0.06)"
  }
} as const;

export const workflowLabels = {
  "relevance-tagging": "Relevance tagging",
  "metadata-extraction": "Metadata extraction",
  "key-findings": "Key findings",
  "compare-papers": "Compare papers",
  "ask-with-citations": "Ask with citations",
  "find-papers": "Find papers",
  "synthesis-note": "Synthesis note",
  "bib-export": "BibTeX export",
  "contradiction-finder": "Contradiction finder",
  screening: "Screening",
  "dataset-method-extractor": "Dataset/method extractor",
  "reproducibility-checklist": "Reproducibility checklist",
  "citation-needed": "Citation needed"
} as const;
