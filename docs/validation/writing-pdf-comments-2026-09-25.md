# Two-way PDF and TeX comments

Scope: OL-01/02 and the comment-linked subset of OL-27. This extends the
[source comment workflow](writing-comments-2026-09-25.md), not a separate PDF
annotation store or a claim of full Overleaf parity.

## Implementation and boundaries

- Select text in the compiled PDF, choose **Comment on selection**, and review
  the corresponding TeX range in the existing comment composer. PDF-only mode
  opens split view and the correct source file.
- Both views use the same canonical thread, replies, decisions and source
  revision. Click a PDF comment mark to open its source discussion; use
  **Show comment in PDF** on a thread to navigate the other way.
- Build outputs retain bounded SyncTeX data. The packaged parser maps only
  manuscript-owned paths to PDF-point boxes. No external input path is exposed;
  the sanitized map is an ignored build cache, not canonical manuscript text.
- Both bundled Tectonic and full XeLaTeX output are supported. A minimal Bun
  patch handles Tectonic's unnamed bundled inputs without treating them as
  manuscript sources. Malformed/unsupported maps do not destroy a valid PDF.
- Full document revisions, assets and entry file must match the successful
  build. Changed files hide marks and block PDF comment creation until compile.
  Old cached PDFs without source maps also need a fresh compile.
- Mapping is line/paragraph-level. Literal selections can narrow to exact TeX
  characters; macros/math remain visibly reviewable source ranges. New PDF
  selections are limited to one page and 8,000 characters. Multi-page existing
  threads can display marks on each mapped page. Ambiguous cross-file ranges
  are rejected rather than guessed. General click-anywhere SyncTeX is not done.
- CodeMirror focused selection now overrides its default lavender background
  with readable theme colours. Provider/model menus use themed, keyboard-
  accessible controls. No provider enablement or model permissions were changed.
- A small highlighter-library patch groups each highlight once per page rather
  than once per rectangle; duplicate opacity layers no longer obscure text.
- The PDF selection menu stays mounted across background status polls and
  uses the latest revision checks. Actual zoom changes dismiss old-position tips.

## Automated validation

- `bun run typecheck`: passed.
- `bun run test --maxWorkers=2`: 253 passed, 2 opt-in native tests skipped.
- `bun run build`: passed; existing Vite large-chunk warning remains.
- `LITAGENT_TEST_TEX=1 bun run test packages/workflows/src/tex-builds.test.ts packages/workflows/src/tex-source-map.test.ts --maxWorkers=1`:
  17 passed, including actual bundled compiler output and parsed source boxes.
- Parser/unit checks cover offsets/units, external paths, unnamed inputs,
  included-file ownership, exact literal matching, paragraph fallback,
  ambiguous selections, stale and resolved marks, multi-page marks and installed
  highlighter page grouping.
- Build/store checks cover map persistence across service restart, current
  revision validation, canonical comment creation, invalid build IDs, malformed
  map failure and cleanup when the last-good build is replaced.

## Native T3 browser validation

Actual UI/backend in disposable repository:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-2N8x4G/research`.
Web `http://127.0.0.1:5191`, API `http://127.0.0.1:3894`, native preview `tab_f`.
Synthetic document `manuscript_14421ad13e25eee9`; real isolated XeLaTeX build
`9481ff56-12cf-4fe8-b1b9-6ac49657cd63` produced 13 sanitized source boxes.
No real manuscript changes, provider credentials or generation requests.

Verified with native browser controls and DOM/canvas inspection:

1. PDF selection opens a composer anchored in `sections/introduction.tex`, not
   the caller `main.tex`. Save creates `comment_9c8d2790cd0784a244de40c7`.
2. Reply from the TeX view, resolve and reopen share that same thread. Clicking
   its PDF mark opens the correct source range and discussion.
3. Keyboard selection in TeX creates `comment_5d56f453f343fe6784eaf880` and a
   second PDF mark. Source-to-PDF navigation targets the selected discussion.
4. Full reload retains both threads/reply and the chosen workspace layout.
5. A synthetic source edit makes the PDF stale: marks disappear, comment action
   refuses with a compile message, and no new thread is created. Undo returns
   the original revision and restores current marks.
6. PDF-only selection switches to split view and opens the included file's
   composer. Discarding this empty draft creates no thread. A selection menu
   remains available across multiple background build-status polls.
7. Dark/Comfy focused selection uses RGB(51,75,112) behind light text; Light
   uses RGB(198,220,250) behind RGB(18,36,59). Source and PDF marks stay readable.
8. Desktop 1440x900 / 1920x1080 and narrow 390x844: no document-level horizontal
   overflow. Nonblank PDF canvases and zoom tested; at 110% the canvas was
   1120x1450 with 7,003 sampled dark pixels. Each thread renders once per page.
9. On narrow screens, **Show comment in PDF** closes the review overlay and
   opens PDF-only mode so the target is visible. Zoom dismisses a selection tip
   positioned for the previous scale; polling without zoom preserves it.

Local screenshots (not committed):

- 1440px source/PDF/comments: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muhg2c58-2aaa606a.png`
- 1920px at 110%: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muhg3m63-7b59653b.png`
- 390px PDF navigation: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muhg8feh-342e4288.png`

## Published checks

Branch: `chat-reliability`. Feature source:
`680c92c09eeb7597fa70a7311a0e0ebb3dcdc886`.
[Run 36189706673](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36189706673)
passed install, typecheck, tests and production build on
`prometheus-literature-01` (runner ID 2), job `108251595674`.
Labels: `self-hosted`, `linux`, `x64`, `prometheus-ci`.
No hosted compute or new macOS/Windows certification.

Small code commits: themed menus `7de1efc`, focused selection `e97752f`,
PDF layer grouping `75eac34`, source-map backend `bad944b`, bundled-input
compatibility `bdc15f3`, two-way comment UI `680c92c`.
