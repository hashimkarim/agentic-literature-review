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
npm install
npm run dev
```

The web app runs on `http://localhost:5173` and the local backend runs on
`http://localhost:3874`.

The backend uses `LITAGENT_REPO` when set. Otherwise it creates a local research
workspace under `~/.litagent/research-repo`.

Project roadmap and implementation progress are tracked in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Useful Commands

```bash
npm run typecheck
npm test
npm run build -w apps/web
npm run dev:server
npm run dev:web
```

## Repository Model

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
workflows/{runId}.jsonl
exports/{projectId}.bib
.litagent/index.sqlite
```

PDFs and large extracted images are configured for Git LFS. Local caches,
thumbnails, and SQLite indexes are intentionally ignored.
