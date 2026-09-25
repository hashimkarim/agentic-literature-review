# Writing Assistant Delivery

The writing assistant uses the existing AgenticDriver execution boundary. No
provider adapter, account or authentication migration is part of this work.
All generated text remains a draft until explicitly accepted. The separately
authorized synthetic live check is recorded below; it changed no dependencies.

## Ordered Work

1. Implemented: explicit literature, manuscript and uploaded code/result context;
   immutable source copies, exact prompt preview, revisions and coverage.
2. Implemented: outlines, storylines, drafting, editing, citation discovery and review;
   multiple candidates, claim/source validation, recoverable acceptance/history.
3. Implemented: persistent assistant sidebar, source selection, evidence inspection,
   bibliography actions, audience/style settings and responsive interaction tests.
4. Implemented (2026-09-25): versioned browser view preferences per document.
   Source/PDF layout, active file, open tabs, collapsed folders, assistant tab,
   right-panel choice and build-output visibility survive refresh/reopening.
   Missing paths are reconciled against the current tree. Draft recovery stays
   separate; temporary comparisons and compilation no longer overwrite layout.
   Typecheck and 201 tests pass; native preview verified split layout, two file
   tabs, collapsed folders and Sources after reloading the imported thesis.
5. Implemented: a consolidated writing toolbar, collapsible desktop file pane,
   compact save/build footer and source/PDF divider with pointer and keyboard
   resizing. The split ratio is retained and adapts to stacked panes on narrow
   screens. Native preview checks cover 1920, 1440, 860 and 390 pixels, menu
   dismissal, file-drawer controls, keyboard resizing, reload and nonblank PDF
   canvas pixels. Existing browser regression scripts now explicitly choose
   their layout and account for restored tabs/panels and the actions menu.
6. Checked (2026-09-25): actual writing UI against the authorized local Codex
   SDK host with synthetic sources only. Explicit model selection, source/quote
   navigation, drafting/review progress and live review cancellation worked.
   No draft was accepted. Catalog refresh and review word-count classification
   remain gaps; see [the live receipt](validation/writing-live-2026-09-25.md).

Backend validation: typecheck and 196 tests pass, including literal quote/ID checks,
separate semantic review, unsupported-result rejection, explicit bibliography
insertion, cursor drafting, acceptance history, cancellation during review and
stale/conflicting source protection. Checks use fixtures, not live model accounts.

UI validation: production build and real app/installed SDK browser tests at
1440, 1920, 860 and 390 pixels pass. Verified explicit mixed-source selection,
zero inference during preview, two-model drafting/support review, exact evidence
inspection, rejection/restoration, bibliography insertion, visual comparison,
history-backed acceptance, unsupported-claim blocking and reload without replay.
Existing writing/history/recovery and folder/ZIP import/edit/build browser suites
also pass at all four widths, as do the real compiler/PDF pixel, zoom, download,
failure-recovery and cancellation checks. A read-only smoke test on the running
app opens the user's imported `thesis-latex` document and Sources tab without
console errors or file changes. No personal sources or test PDFs are committed.

Entry point: Writing -> open a document -> AI assistant. Compose, Sources and
Drafts stay beside the editor; narrower screens use a dismissible side panel.
Each generated candidate uses one generation call and one support-review call
through the explicitly selected AgenticDriver model. This is not independent
fact certification and no heuristic/provider fallback is used.

## Boundaries

- Credential checks apply to attachments, selected manuscript sources and the
  active selection/surrounding text before dispatch. These are best-effort checks,
  not a complete secret scanner; exact context still requires user review.
- Uploaded code, CSV/JSON results, W&B exports and benchmark text are selected
  snapshots, not live filesystem or W&B connections. Source URLs are provenance,
  not permission to fetch arbitrary hosts. No uploaded code is executed.
- Literature means selected converted papers in the document's linked projects
  (or explicitly selected global papers when unlinked), not an unrestricted web
  search. Missing/full-text/truncation states must remain visible.
- Citation identity and revision validation are deterministic. Claim support is
  separately model-reviewed and labeled as such, not certified factual truth.
- Live external search/connectors, continuous folder sync and model quality
  evaluation remain separate delivery work and must not be reported as finished.
