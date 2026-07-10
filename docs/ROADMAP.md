# LitAgent Roadmap And Progress

Updated: 2026-07-10

LitAgent is a local-first, project-centered literature review workspace. Papers
are canonical global records; projects reference them with their own screening
state, tags, collections, notes, questions, and generated research artifacts.

## Delivery Snapshot

| Area | State | What Works Today | Main Gap |
| --- | --- | --- | --- |
| App foundation | Working | Bun/TypeScript monorepo, React web app, Electron shell, local server | Desktop packaging and update/install flow |
| Library and projects | Working | Global deduplicated papers, project links, collections, project-specific tags | Rich DOI/arXiv/Zotero metadata deduplication |
| PDF import and conversion | Working | Recursive PDF inbox, upload import, bundled Marker runtime path, assets, Markdown, passages, FTS refresh | Packaged-runtime validation on all desktop targets |
| PDF reader | Working | PDF.js highlighter, text/area/drawing annotations, colors/fill, persistence, citation jumps | Exact generated citation rectangles on more PDFs |
| Markdown reader | Working | GFM, figures/assets, KaTeX equations, tables, links, algorithm rendering | Editing and side-by-side PDF/Markdown mode |
| Search and cited Q&A | Working MVP | Scoped FTS, provider-backed Markdown-context answers, persistent chat threads, linked supporting evidence | Anchor-based citation validation and conversation-aware follow-ups |
| Provider harness | Working MVP | Codex, Claude, Gemini, OpenCode, Copilot and custom CLI discovery/settings, streaming, cancellation, normalized logs | PTY/ACP support, approval prompts, resume and richer model discovery |
| Agent workflows | Partial | Queue, provider/model selection, conversion, Q&A, workflow artifacts and basic recipes | Structured reviewable outputs for relevance, metadata, findings, comparison and discovery |
| Notes | Backend foundation | Markdown note CRUD and annotation links | Real editor, backlinks, workflow-to-note flow and note search UI |
| Concept map | UI prototype | Paper/tag graph surface | Real project graph API, filters, relationships and saved layouts |
| Bibliography and Zotero | Partial | Project BibTeX export and stored Zotero keys | BibLaTeX/CSL import/export and Zotero interchange/sync |
| Git and LFS | Foundation | Repository bootstrap, LFS policy and status display | Commit/sync UI, conflict handling and recovery guidance |

The core reading loop is usable: import a PDF, convert it, read/annotate it,
ask a provider-backed question, and jump from supporting evidence to the source.
The app is not feature-complete yet because most research workflows still emit
generic Markdown transcripts instead of structured, reviewable domain records.

## Ordered Milestones

### 1. Reviewable Agent Outputs

Status: in progress.

- Persist evidence-backed relevance proposals per paper and research question.
- Accept, edit, or reject a relevance proposal before changing project state.
- Persist metadata patch proposals with field-level evidence and review actions.
- Turn findings, methods, datasets, limitations, and reproducibility results into
  typed records instead of unstructured workflow transcripts.
- Build comparison and synthesis artifacts from accepted records and evidence.

### 2. Research Notes And Evidence Ledger

Status: backend foundation exists.

- Replace the placeholder notes reader with a Markdown editor and note browser.
- Create notes from annotations, evidence, Q&A messages, and workflow outputs.
- Render backlinks to papers, passages, annotations, workflow runs, and research
  questions.
- Add an evidence ledger for claims, source passages, confidence, and note links.
- Add citation-needed and contradiction review flows.

### 3. Retrieval Quality

Status: working MVP.

- Put stable passage anchors into provider context and require anchor citations.
- Validate every answer citation and ask the provider to revise unsupported claims.
- Add conversation-aware follow-up questions without losing the selected scope.
- Add optional embeddings/reranking after the FTS baseline is measured.
- Improve Markdown-to-PDF rectangle alignment and page mapping.

### 4. Discovery And Screening

Status: recipe placeholders.

- Implement related-paper discovery through DOI, arXiv, Crossref, OpenAlex, and
  Semantic Scholar adapters with explicit import review.
- Add include/exclude/maybe screening with research-question rubrics.
- Track deduplication and PRISMA-style import/screening counts.
- Add reusable automatic and manual workflow recipes per project.

### 5. Interchange And Version Control

Status: partial.

- Import/export BibTeX, BibLaTeX, and CSL JSON while preserving Zotero keys.
- Add Zotero watched-folder compatibility before any direct write-back.
- Add Git diff, commit, pull/push, LFS health, and conflict recovery UI.
- Export notes, evidence ledgers, comparisons, and Q&A threads as tracked files.

### 6. Concept Map And Desktop Delivery

Status: prototype/foundation.

- Build graph data from projects, papers, authors, tags, methods, datasets,
  citations, research questions, and accepted evidence records.
- Add graph filters, node-to-paper selection, and saved project layouts.
- Package the local backend, Marker runtime, web assets, and Electron shell.
- Add first-run repository selection, migrations, backup, and recovery checks.

## Definition Of MVP Complete

The local MVP is complete when a clean desktop install can:

1. Create a project and research question, then import/link the same paper across
   multiple projects without duplicating the canonical PDF.
2. Convert PDFs to readable Markdown with figures, equations, passages, and a
   rebuilt search index using the packaged runtime.
3. Read and annotate PDFs, write linked notes, and reopen both after restart.
4. Run relevance, metadata, findings, comparison, synthesis, and cited Q&A with
   a selected CLI provider/model and review structured outputs before applying
   canonical changes.
5. Jump every retained evidence reference to Markdown and the best available PDF
   page/selection, or clearly report that support was not found.
6. Export a project bibliography and tracked research artifacts, then show a
   healthy Git/Git LFS state.

## Deferred

- Hosted web sync and team collaboration.
- Silent Zotero write-back.
- Cloud-hosted indexes or provider credentials.
- Exact PDF rectangles where the source PDF does not expose reliable text geometry.
