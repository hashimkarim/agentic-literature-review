# Existing local PDF and Markdown folders

Task branch: `chat-reliability`. SDK remains exactly `0.2.0-alpha.6`.
No provider requests, conversion, service/grant changes or real-library imports
were needed for this feature.

## Scope

- Preview and select existing PDF/Markdown pairs, PDF-only or Markdown-only
  documents, including separate roots and manual Markdown selection.
- Copy original sources and referenced images, or attach read-only live files.
- Reuse existing PDF IDs and preserve curated metadata/Markdown; explicitly add
  missing Markdown to an existing linked PDF without duplicating it.
- Refresh passages/search, reader text and images after outside changes.
  Markdown-only changes do not replace the PDF canvas or reset its scroll.
- Machine-local paths are stored under ignored `.litagent/paper-links/`, not in
  synchronized paper metadata. No converter or Markdown write replaces linked
  sources. Links do not transfer filesystem authority through Git.

## Local checks

- `bun install --frozen-lockfile --ignore-scripts`: passed.
- `bun run typecheck`: passed.
- `bun run test`: 347 passed, 2 skipped, 45 files. Includes new matching, copying,
  live-source, root-identity, symlink/traversal, original-byte/image, duplicate,
  invalid-PDF, citation-revision, search-refresh and HTTP-route checks.
- `bun run build`: passed. Final web rebuild also passed; existing large-chunk
  advisory remains.
- `git diff --check`: passed.

## Native T3 browser

Actual app/backend at `http://127.0.0.1:4387`, disposable repository
`/tmp/litagent-linked-folder-ui-G4R62f/research`. No mocked provider or connection.
Desktop viewport 1440x900; import dialog also checked at 390x844.

1. Library > Import > Local path; entered the actual `thesis-docs` path and used
   Enter to scan. Preview detected `literature/pdf` and `literature/markdown`:
   219 PDFs, 108 matched Markdown files, 111 PDF-only, no truncation. This was
   read-only; those 219 papers were not imported into the user's library.
2. Copied two real Heydari papers and their existing Markdown/images to the
   disposable `paper-sources` folder. Attached the 2021 BeatNet pair through
   the narrow UI: one imported, zero failures. The dialog had no horizontal
   overflow; actions remained reachable by scrolling.
3. Opened the PDF/Markdown split reader. PDF canvases were nonblank; Markdown
   preserved headings, math and existing text. All three linked figures loaded
   (natural widths 1251, 607, 618), including paths with literal spaces.
4. Edited only the disposable Markdown externally. Text appeared without a
   reload, and app search returned its new passage. PDF canvas/container identity
   and scrollTop (16) were unchanged. Removing the external marker also refreshed.
5. Moved the disposable Markdown root away: unavailable status, no stale text,
   no PDF canvas, and zero search results for the removed passage. Restoring the
   same root recovered the readers and passages automatically.
6. Selected Import a copy for the 2022 paper. Exercised the inline matching
   picker, searched for its Markdown, selected it, and imported successfully.
   With its test PDF/Markdown/assets moved away, the copied paper still rendered
   its 25,006-character reading copy, PDF and figure (natural width 1455).
7. Browser reload retained the linked paper and split view. Original source
   hashes were checked afterward: all eight original PDF/Markdown/image files
   unchanged. External editing/moving was confined to disposable copies.

Screenshots (local T3 artifacts):

- Narrow import: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mummt2iy-6b8bb23b.png`
- Linked reader: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mumn1sbj-571cfa7d.png`

## Boundaries

Scans are localhost-only and exclude symlinks, private/generated directories and
oversized files. Existing selected files refresh; newly added papers require a
rescan. Linked papers are read-only in LitAgent, unlike linked writing documents.
Moving/replacing an authorized root fails closed rather than granting access to
a different directory. This is local import/reader/index acceptance, not a new
model or RAG-generation qualification.
