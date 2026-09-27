# Manual suggested edits

Scope: OL-03, built on the existing source/PDF comments and file history. This
does not implement continuous tracked changes, collaboration identities, or
automatic AI edits. No SDK dependency, provider grant or authentication changes.

## Behavior

- Comment composer has Comment/Suggest edit modes. Proposed replacements,
  including intentional deletion, keep their captured source and recover after
  reload. Posting a suggestion does not edit the manuscript.
- Threads show the original and proposed text, a side-by-side comparison, and
  explicit accept/reject controls. Decisions remain visible in resolved threads.
- Accept requires the reviewed source revision and current thread version.
  Changed source, even a relocatable quote, requires explicit reattachment;
  overlapping suggestions cannot silently apply to a different revision.
- Acceptance records a normal restorable text-history entry. Rejection does not
  change the source or its history. Reopening discussion cannot revive a decided
  replacement. Deleted threads remove proposed text as well as comment content.
- A write-ahead intent coordinates source, history and decision writes. Recovery
  completes the same edit once. An intervening external change is preserved and
  its interrupted intent archived under `.comments/.interrupted/`; the document
  remains editable and the old suggestion requires review. Invalid journal
  integrity fails closed. Review files are excluded from source ZIP exports.

## Automated checks

- `bun run typecheck`: passed.
- `bun run test --maxWorkers=2`: 289 passed, 2 existing native opt-in skips,
  across 41 test files.
- `bun run build`: passed; existing Vite large-chunk warnings remain.
- Added storage/HTTP coverage for explicit acceptance/rejection, deletion,
  immutable decisions, source/thread conflicts, idempotent retry, restoring
  history, restart at each write boundary, external edits, source ownership,
  strict payloads and unsafe paths. Browser helpers cover unsaved/stale sources
  and recoverable replacement/deletion drafts.

## Native T3 browser

Actual app started with `scripts/prepare-writing-review-check.ts`, ports 5197
and 3957. Disposable repository:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-H3ivDJ/research`.
Document `manuscript_18ab29545fe89fc7`; no private driver connection or model calls.
Real manuscripts and shared services were untouched.

Verified through native browser interactions, DOM reads and actual HTTP records:

1. First screen -> Writing -> synthetic document -> selected TeX paragraph.
2. Suggest-edit composer, replacement input and reload recovery with the same
   revision/range/quote. Posting leaves source unchanged.
3. Before/after comparison, acceptance, updated editor text and the visible
   Accepted suggestion history entry. Rejection leaves the file hash unchanged.
4. Prefix edit/autosave disables acceptance; explicit current-selection
   reattachment restores it. Accepting another edit invalidates stale suggestions.
5. Real isolated TeX Live build, PDF text selection -> source-mapped comment ->
   suggested replacement -> acceptance. The old PDF is marked Earlier revision;
   recompilation shows the accepted wording and returns to Up to date. Its
   890x1150 canvas had 1,864 sampled dark pixels, confirming nonblank rendering.
6. Light and Comfy foreground/background computed styles; desktop has no page
   overflow. A same-origin 390x844 iframe rendered the actual app with no
   horizontal overflow or clipped accept/reject labels, then was removed.

T3 snapshot capture consistently failed with PreviewAutomationExecutionError;
resize/keyboard calls sometimes reported errors despite applying their action.
Some controls were exercised using native `preview_evaluate` DOM clicks and
CodeMirror's public selection API. The narrow check used an iframe because the
resize tool timed out. These are interaction/layout checks, **not screenshot
visual approval**; no standalone browser was substituted.

## Publication

Backend commit `69857b7ddfeec4f0466a9b8b228c71c06ff6fe52` passed
[Prometheus run 36318603887](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36318603887),
job `108617947516`, repo runner `2` (`prometheus-literature-01`). The editor
integration is committed as `037f760c03bfa9f985dfd63c5e3376101ec95278` on
`chat-reliability`, including recovery follow-up `437f07a`. Its
[Prometheus run 36320116245](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36320116245)
passed frozen-lockfile installation, typecheck, tests and build in job
`108622201936`, on the same repo runner `2` (`prometheus-literature-01`).
No hosted CI used; no main publication.
