# AGENTS.md

## Task Completion Requirements

- Run `bun run typecheck` and `bun run test` before considering implementation work complete.
- For rendered UI changes, run the web app and verify the first screen plus one interaction.
- Prefer correctness and recoverable failure modes over optimistic shortcuts.

## Git Workflow

- Make local commits once a feature, fix, or coherent unit of progress is complete and verified.
- Keep commits small and incremental; avoid large dump commits that mix unrelated work.
- Each commit should leave the app in a working state and should not knowingly break typecheck, tests, or core workflows.
- Stage changes intentionally so unrelated user work or generated artifacts are not swept into a commit.

## Source Language Policy

- Use TypeScript (`.ts`) and TSX (`.tsx`) for handwritten app and package source.
- Avoid new JavaScript/JSX source files except for generated output, third-party files, or config files that must remain JavaScript.
- Prefer Bun-driven TypeScript scripts for local automation.

## Project Snapshot

LitAgent is a local-first, project-centered literature review workspace. It uses
a global paper library, project-specific paper links, file-backed research
artifacts, rebuildable indexes, and CLI-backed agent workflows.

## Package Roles

- `apps/server`: local HTTP/WebSocket backend, repository API, workflow API, provider status, Git status.
- `apps/web`: React/Vite UI for projects, library, readers, workflows, evidence, and concept map.
- `apps/desktop`: Electron wrapper that launches/hosts the local web app experience.
- `packages/contracts`: schema-only shared Zod contracts and TypeScript types. No runtime business logic.
- `packages/library`: file-backed research repository, paper/project model, Git policy, BibTeX export.
- `packages/indexer`: local SQLite/FTS passage index and search.
- `packages/agents`: provider catalog, CLI discovery, adapter lifecycle, normalized provider events.
- `packages/workflows`: document conversion, passage extraction, Q&A, relevance, metadata, and output recipes.
- `packages/pdf`: PDF viewer integration primitives.
- `packages/ui`: design tokens shared by app surfaces.

## Provider Adapter Rules

Provider-specific code stays in `packages/agents`. Workflow code should consume
normalized provider events and should not parse provider-specific CLI output
directly. Adapter implementations should support:

- provider discovery/version/auth status
- start/send/interrupt/stop lifecycle
- normalized event emission
- best-effort NDJSON event logging
- clear failure classification

## Research Repository Rules

- Canonical PDFs, Markdown, assets, and metadata live in `library/`.
- Projects never duplicate paper files; they store `paper-links.json` records.
- Importing through a project imports globally and then adds a project link.
- SQLite indexes, thumbnails, and caches stay under `.litagent/` and are ignored.
- Agent output is a proposal or artifact unless the user explicitly accepts it.
