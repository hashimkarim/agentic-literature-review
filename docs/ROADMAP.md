# LitAgent Roadmap And Progress

Updated: 2026-06-02

This file tracks the implementation plan and current state for the local-first,
project-centered agentic literature review app.

## Current Progress

### Completed MVP Foundation

- TypeScript monorepo scaffold with `apps/web`, `apps/server`,
  `apps/desktop`, and shared packages.
- Local backend with HTTP APIs for projects, papers, conversion, search, Q&A,
  workflows, exports, provider status, Git status, and run event streaming.
- Global paper library model with project-specific paper links so one paper can
  belong to multiple projects without duplicating canonical files.
- File-backed research repository layout for tracked metadata, notes, Markdown,
  passages, workflow logs, and bibliography exports.
- Git policy bootstrap with `.gitattributes` for PDF and large asset LFS
  patterns, plus ignored local indexes, caches, build output, and transient
  artifacts.
- SQLite/FTS passage index package with scoped search support.
- CLI provider catalog and discovery for Codex, Claude, Gemini CLI, OpenCode,
  Copilot CLI, and custom Cursor-like commands.
- Agent harness MVP inspired by T3 Code/BigBud provider architecture:
  provider definitions, adapter registry, in-memory session directory, CLI
  session lifecycle, normalized stream events, NDJSON event logging, cancellation
  hooks, artifact capture, and failure classification.
- Provider settings page and API inspired by T3 Code/BigBud settings flows:
  provider enable/connect state, command overrides, default/custom models,
  provider/model selectors for agentic tasks, and workflow queue cancellation.
- Workflow package with normalized workflow records, document conversion hooks,
  Q&A artifact generation, relevance/metadata/comparison workflow recipes, and
  event logging.
- Project-centered React UI with top bar, left navigation, project sidebar,
  paper list, reader tabs, evidence/agent panel, workflow queue, status bar, and
  concept map surface.
- Active section layout where the global left navigation persists and
  settings/workflows/notes/exports/concept map replace the workspace instead of
  inheriting project and agent side panels.
- Desktop Electron wrapper for the local web app experience.
- Theme system with light, T3-style dark default, and exact Comfy material color
  theme sourced from `/mnt/shared/Git/comfy-themes/design-system/colors_and_type.css`.
- Unit tests for paper deduplication, project membership, multi-project links,
  provider event normalization, and SQLite FTS search.

### Partially Implemented

- PDF import copies papers into the global library and links them to a project
  when imported through a project; richer DOI/arXiv/Zotero deduplication is
  stubbed beyond the current metadata/hash behavior.
- Markdown conversion writes Markdown, conversion summaries, and passage records;
  the full Marker worker port from the thesis workspace is not wired in yet.
- PDF/Markdown/Notes reader tabs exist with PDF.js/Lector integration helpers,
  but persistent annotations and exact PDF rectangle mapping are still pending.
- Q&A uses scoped retrieval and cited evidence records; agent reranking and
  provider-backed answer generation still need full CLI runtime execution.
- Provider-backed workflows can launch real CLI runs in the background and write
  normalized events to workflow logs. This is still subprocess-based rather than
  a full PTY/SDK/ACP runtime, and provider-specific stream parsers are heuristic
  beyond common JSON and stdout/stderr shapes.
- Agentic workflow launches now carry an explicit provider and model choice from
  the UI, and saved workflow records retain the selected model.
- Concept map uses graph-oriented project/library data, but saved layouts and
  advanced filters are not finished.
- BibTeX export exists for project scope; BibLaTeX, Zotero import/export, and
  sync-folder compatibility need further work.

## Phase Plan

### Phase 1: Scaffold And Storage

Status: mostly complete.

- Create monorepo, Electron/web/server apps, shared contracts.
- Implement repo initialization, Git LFS config, SQLite setup.
- Implement project/global library model.

### Phase 2: Import And Conversion

Status: partial.

- Import PDFs globally or through a project.
- Link project membership automatically when imported through a project.
- Port Marker workflow into a local worker.
- Generate Markdown, assets, summaries, and passage records.

### Phase 3: Readers And Notes

Status: partial.

- Integrate Lector/PDF.js PDF viewer.
- Add Markdown viewer.
- Add annotation and note persistence.
- Add citation jump from evidence to PDF/Markdown.

### Phase 4: Search And Q&A

Status: partial.

- Build SQLite FTS index.
- Implement scoped search.
- Implement cited Q&A with retrieved passages and saved answer artifacts.

### Phase 5: Agentic Workflows

Status: partial.

- Implement CLI provider adapter framework.
- Add relevance tagging, metadata extraction, summaries, comparisons, and
  related-paper search.
- Add workflow queue UI and run logs.

### Phase 6: Exports And Concept Map

Status: partial.

- Add BibTeX/BibLaTeX exports.
- Add Zotero sync-folder compatibility.
- Add Cytoscape concept map.
- Add Git status/commit UI.

## Next Work

- Wire the existing Marker conversion script into the backend worker path.
- Expand provider harnesses with provider-specific SDK/ACP stream parsers,
  approval/user-input round trips, session resume, PTY support where needed, and
  persisted session recovery.
- Add richer provider model discovery where CLIs expose live model lists instead
  of only configured/default/custom model values.
- Persist PDF annotations and note backlinks.
- Add exact citation jump resolution from evidence to Markdown range and PDF
  page/selection.
- Expand bibliography support to BibLaTeX and Zotero import/export formats.
- Add integration and E2E coverage for import, conversion, Q&A, annotations,
  workflow queue streaming, export, and concept map filtering.
