# Writing usability checks, 2026-09-25

Native T3 browser, disposable research repository and synthetic text only.
No generation requests or changes to the user's thesis were made.

## Selection and comments

- Inspected actual editor at 1440 x 900, selected TeX via CodeMirror's public
  selection API, then clicked the contextual Comment action in the native
  browser. Entered and saved a synthetic comment through the visible form.
- Selection foreground is now explicit in both the rendered selection marks
  and native `::selection`. This avoids syntax colors becoming unreadable on
  the selection background. Comfy/dark use white on dark blue; light uses dark
  text on pale blue. PDF text remains transparent over its canvas.
- Comment capture still flushes source saves and verifies its quoted revision.
  The contextual action also has a keyboard binding, Mod-Alt-M. Existing
  comment anchors and draft recovery are unchanged.
- Repeated on the final UI: selected a synthetic paragraph, used Comment beside
  the selection, entered the comment in the sidebar and saved it. The thread
  showed its quoted passage and one open comment; manuscript text was unchanged.
- Typecheck and the 233-test suite passed (two native compiler checks skipped).
  The production build passed with the existing large-chunk warning.

## Folder imports

Fixtures: `bun scripts/prepare-import-fixture.ts`, imported through the native
T3 browser into `scripts/prepare-writing-review-check.ts`'s disposable app.

- Writing > Sources > Add workspace folder: paste an absolute path, scan,
  inspect the list, select files and attach. Three nested code/result/note
  sources attached; hidden files, credential filenames and dependencies were
  excluded. Originals and manuscript text remained unchanged. Attached copies
  were not automatically selected for model context.
- Library > Import: scanned nested PDFs, imported two valid generated documents
  and displayed the invalid file's own error. The list refreshed without a
  browser reload. The imported PDF rendered as one page, 530 x 685 canvas pixels,
  with 1,099 dark pixels. Native text selection retained a transparent text
  layer with a 30%-alpha blue selection over the readable canvas.
- Library > Zotero opens the local storage-folder import directly. Reimported
  the same PDFs from synthetic eight-character attachment subfolders: both
  succeeded and the library remained at five records (three seeded records plus
  the two new PDFs), with no duplicated canonical papers.
- At 390 x 844, the import dialog and footer fit the viewport; its client and
  scroll widths both measured 355px. Also checked the desktop first screen and
  import interaction at 1440 x 900. This does not certify the entire old library
  shell as mobile-ready.
- Local path access requires a loopback request and an explicit local-action
  header. Previews expire, validate file identities and reject changed paths,
  symlinks, oversized files and binary text. Imports are sequential and can stop
  after the current file. Per-entry failures can be retried without replaying
  successful entries in the same preview.
- Browser-file upload also passed: supplied an invented JSON `File` through
  the native preview's DOM file-input interface, selected it in the dialog,
  attached it and observed the source catalog update. No real local file was read.
- Local Zotero storage import copies PDFs only. No Zotero database/API,
  cloud-only attachment fetching, linked-file discovery or metadata sync is
  claimed. Sources are snapshots, not live watched folders. Preview is bounded
  to 2,000 eligible files; existing source count/size limits remain explicit.

## Connection controls

- Native Settings saved the selected local driver address using a private token
  file read server-side, refreshed discovery, selected `gpt-6-luna` explicitly
  and enabled `driver.local-codex`. Reload preserved the connection and model.
- An unused loopback endpoint with a synthetic credential showed Unavailable
  and disabled the previous instance. Restoring the permitted endpoint required
  explicit model selection and enablement again; no provider/model fallback.
- Connection health and provider authentication remain separate: catalog access
  is Connected while native account authentication is unverified until a run.
  No generation request was made. Credentials remain in ignored server-side
  storage with mode 0600, not browser storage or receipts.
- The user's normal workspace was inspected read-only and had no driver
  configured. Its manuscript, unsent comment draft and papers were not modified.
  The validation-only credential was not copied into that research repository.
- SDK runtime remains the qualified 6f72acc route. This check does not replace
  original AD-035 run/cancellation receipts or establish new inference/usage
  certification. SDK successor Linux CI and SDK first-hop Usagestat evidence
  belong to that repository, not this application's checks.

## Final checks

`bun run typecheck`, `bun run test` (236 passing, two opt-in native compiler
checks skipped) and `bun run build` passed. The build retains its existing
large-chunk warning. Native T3 was used for interactive verification; the
assistant's unattended browser regression script was updated for the new
preview/selection flow but was not rerun through a separate browser harness.
See [Prometheus CI](../PROMETHEUS_CI.md) for exact application source/job IDs.
