# LitAgent

Project-centered, local-first agentic literature review workspace.

LitAgent keeps papers in a global library while projects and subcollections
reference those papers with project-specific tags, relevance decisions, notes,
and workflow outputs. The MVP is a desktop/web app backed by a local server,
Git-friendly files, Git LFS patterns for PDFs/assets, rebuildable local indexes,
and CLI adapters for agentic providers such as Codex, Claude, Gemini CLI, and
OpenCode.

## Development

```bash
bun install
bun run dev
```

The web app runs on `http://localhost:5173` and the local backend runs on
`http://localhost:3874`.

The backend uses `LITAGENT_REPO` when set. Otherwise it creates a local research
workspace under `~/.litagent/research-repo`.

Project roadmap and implementation progress are tracked in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Writing

Writing is a global tab with its own searchable document list. Documents can link
zero, one or several projects, and each project can be reused in multiple
documents. Link/unlink projects from the document header or list; unlinking does
not delete text, history or alternatives. Existing project-owned manuscripts
migrate automatically into `manuscripts/` with their original IDs and history.

Each document provides a multi-file TeX/BibTeX editor with autosave, local
draft recovery, version history, named checkpoints, diff review and source ZIP
export. History is per-file and independent of Git commits.

Compile saved sources locally and view the PDF beside the editor or on its own.
Build errors link to source lines; cancellation and failed builds retain the last
successful PDF. The preview labels earlier revisions and supports PDF download.
Linux uses an isolated offline Tectonic runtime prepared with
`bun run prepare:tex-runtime`; it does not need a system TeX Live installation.
See [TeX Runtime](docs/TEX_RUNTIME.md) for sandbox prerequisites, supported packages
and remaining desktop packaging work.

Select TeX prose to request alternatives from explicitly enabled AgenticDriver
connections, including several outputs from the same model. Preview the supplied
context, choose an audience level, compare drafts and explicitly accept one.
Generation never automatically replaces text, and changed source revisions block
stale suggestions. These editing drafts are not evidence-verified claims.

Project links organize documents; they do not yet feed project sources into
generation. Internal/literature evidence attachment, citation insertion,
bidirectional source/PDF navigation and cross-platform compiler packaging remain
pending. See [Writing Mode](docs/WRITING_MODE.md) for the full scope.

## Useful Commands

```bash
bun run typecheck
bun run test
bun run --filter @litagent/web build
bun run dev:server
bun run dev:web
bun run prepare:marker-runtime
bun run test:writing-ui
```

`prepare:marker-runtime` creates an ignored local Marker runtime under
`resources/converters/marker` using `uv`, or copies a prebuilt runtime when
`LITAGENT_MARKER_RUNTIME_SOURCE=/path/to/runtime` is set. Packaged Electron
builds should include `resources/converters` as app resources so PDF-to-Markdown
works without a user-global `uvx`/Marker install. In development, LitAgent still
falls back to `uvx --from marker-pdf marker_single` when no bundled runtime is
present.

`test:writing-ui` expects the web dev server and starts an isolated application
backend plus the installed SDK's synthetic HTTP host. It uses Bun's `tsx`
launcher with Node (the SDK-supported host runtime), temporary research files,
and no real provider accounts. It checks history, recovery, alternative review,
cancellation and reloads at desktop and narrow viewport sizes.

## Repository Model

Optional local/remote agent execution through the shared AgenticDriver SDK is
documented in [AgenticDriver setup](docs/agenticdriver.md).

```text
library/
  papers/{paperId}/paper.pdf
  papers/{paperId}/metadata.json
  papers/{paperId}/zotero.json
  markdown/{paperId}/paper.md
  markdown/{paperId}/assets/
  passages/{paperId}.jsonl
projects/{projectId}/
  project.json
  collections/{collectionId}.json
  research-questions.json
  paper-links.json
  notes/*.md
  outputs/*.md
manuscripts/{manuscriptId}/
  manuscript.json              # projectIds references, no owning project
  main.tex
  sections/*.tex
  references.bib
  .history/
  .candidates/
workflows/{runId}.jsonl
exports/{projectId}.bib
.litagent/index.sqlite
```

PDFs and large extracted images are configured for Git LFS. Local caches,
thumbnails, and SQLite indexes are intentionally ignored.
