# Writing comments acceptance

Scope: OL-01/02 in [Overleaf parity](../OVERLEAF_PARITY.md). This is local-author
review, not multi-user collaboration, continuous track changes or role-based
access control. Sources remain authoritative; comments do not modify TeX.

## Implementation

- Strict shared schemas, bounded per-document/thread storage, atomic writes,
  version conflicts and idempotent request handling.
- Comments live in `manuscripts/{id}/.comments/`; they are not included in source
  ZIP exports. Deleted threads retain an ID/version tombstone without text or
  quoted source. Deleted messages retain a placeholder, not their body.
- Anchors capture exact source revision, range, quote and surrounding context.
  Unchanged quotes can move only when context identifies one location. Changed,
  missing or ambiguous text cannot silently link to another passage.
- File moves migrate comment paths through the existing move journal. Text
  restores preserve discussions and re-evaluate locations.
- CodeMirror source marks and cross-file jumps, current/all-file and status
  filters, search, replies/edit/delete, resolve/reopen and manual reattachment.
- Comments-panel preference preserves source/split/PDF layout. On narrow
  screens a passage jump closes the overlaid panel to reveal the source.
- New-comment drafts keep their captured selection across reloads. Recovery
  failures are visible; a stale tab cannot overwrite a newer stored draft.
  Unsent replies/edits are retained on API failure but are not yet durable across
  reloads. Mention identities, live updates and review history remain backlog.

## Automated checks

- `bun run typecheck`
- `bun run test`: 233 passed, 2 opt-in native compiler tests skipped.
- `bun run build`: passed; Vite still reports existing large-chunk warnings.
- Storage/API tests cover lifecycle/restart, duplicate requests, stale revisions,
  stale thread versions, cross-document IDs, strict input, symlink rejection,
  moved/duplicated/deleted source, explicit reattachment and ZIP exclusion.
- Editor tests cover exact revision/quote decoration, transaction mapping,
  invalidation and persisted comments/split layout.
- Draft tests cover empty/populated recovery, clearing after posting/discard,
  distinct documents, multi-tab conflicts, unavailable storage and legacy null.

## Native T3 browser

Started actual application servers with
`bun scripts/prepare-writing-review-check.ts`. Isolated synthetic repository:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-iSUMrN/research`.
Web `http://127.0.0.1:5184`, API `http://127.0.0.1:3887`.
No SDK connection/token; zero generation requests. Real research files and
shared services were not changed.

Verified in the product-native collaborative browser:

1. First screen, Writing navigation and synthetic document/file selection.
2. Source selection -> comment -> persisted thread and source mark.
3. Reply, edit, resolve, resolved filter and reopen.
4. Switch to `main.tex`, click quote, open the other file at the exact range.
5. Unsent new comment and split/panel/file preferences survive full reload.
6. Prefix insertion/autosave relocates both tested anchors; replacing the quote
   detaches them and removes marks. Explicit selection reattachment succeeds.
7. Search and current/all-file filters narrow actual threads.
8. Delete a disposable thread, verify its absence through the real API. The
   confirmation dialog was accepted with a temporary test-only `window.confirm`
   override, immediately restored. No application deletion bypass was added.
9. Simulated another client's reply through the real API. Stale UI reply fails
   with 409 and retains its text; refresh then retry succeeds without losing the
   concurrent reply. Reload verifies the final saved discussion.
10. Desktop 1440x900 and narrow 390x844 layouts; no horizontal page overflow,
    readable controls, and mobile quote jump exposes the selected source.

Screenshots (local, not committed):

- Desktop: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muh96533-3d5f6c07.png`
- Narrow review panel: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muh8xa5k-5cfdedd0.png`

Repository Actions inventory returned no workflows or runs. No hosted CI is
claimed. The UI commit is held locally under the user's Prometheus CI migration
instruction; earlier storage/roadmap pushes predate that instruction.
