# Writing Assistant Delivery

The writing assistant uses the existing AgenticDriver execution boundary. No
provider adapter, account, authentication or live-inference migration is part
of this work. All generated text remains a draft until explicitly accepted.

## Ordered Work

1. Implemented: explicit literature, manuscript and uploaded code/result context;
   immutable source copies, exact prompt preview, revisions and coverage.
2. Implemented: outlines, storylines, drafting, editing, citation discovery and review;
   multiple candidates, claim/source validation, recoverable acceptance/history.
3. In progress: persistent assistant sidebar, source selection, evidence inspection,
  bibliography actions, audience/style settings and responsive interaction tests.

Backend validation: typecheck and 194 tests pass, including literal quote/ID checks,
separate semantic review, unsupported-result rejection, explicit bibliography
insertion, cursor drafting, acceptance history, cancellation during review and
stale/conflicting source protection. Checks use fixtures, not live model accounts.

## Boundaries

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
