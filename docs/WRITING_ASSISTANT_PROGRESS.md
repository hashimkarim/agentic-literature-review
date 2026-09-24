# Writing Assistant Delivery

The writing assistant uses the existing AgenticDriver execution boundary. No
provider adapter, account, authentication or live-inference migration is part
of this work. All generated text remains a draft until explicitly accepted.

## Ordered Work

1. Implemented: explicit literature, manuscript and uploaded code/result context;
   immutable source copies, exact prompt preview, revisions and coverage.
2. Implemented: outlines, storylines, drafting, editing, citation discovery and review;
   multiple candidates, claim/source validation, recoverable acceptance/history.
3. Implemented: persistent assistant sidebar, source selection, evidence inspection,
   bibliography actions, audience/style settings and responsive interaction tests.

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
