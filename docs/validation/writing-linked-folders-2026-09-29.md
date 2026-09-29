# Linked Writing Folders

Implementation: `7be2e56` (store/API) and `f15550d` (editor/import UI), followed
by the excluded-folder, missing-link and private-path regressions committed with
this receipt.

## Scope

- An explicit localhost-only preview/attach action accepts an absolute path on
  the backend machine. It does not upload or create another editable source tree.
- Saves target the original folder with revision checks. Existing file permissions
  survive replacement. Comments, history, proposals and compiler outputs remain
  app-owned; source scripts are not executed.
- Local path/directory identity is in ignored `.litagent/manuscript-links/`.
  Root replacement, missing links and unsafe descendant paths fail closed.
- The active editor refreshes every three seconds and on focus. Unsaved conflicts
  are preserved, including files deleted externally and drafts recovered on reload.
- Linked rename/delete operations deliberately remain in the file manager.
  Existing copy imports still use the full app-owned file-tree operations.

## Native T3 Browser

Used the actual app HTTP backend and built UI at `http://127.0.0.1:4387`, with a
disposable repository and source folder under
`/tmp/litagent-linked-folder-ui-G4R62f/`. No provider responses were substituted,
no model was called, and no user manuscript was edited or accepted.

Verified at 1920x1080, 1440x900 and 390x844:

1. Writing > Import > Attach local folder, path entry, native Enter-key preview,
   main-file selection and attachment.
2. An outside file edit and newly created TeX file appeared without page reload.
3. An editor save was read back from the original file on disk.
4. A competing external write preserved both disk text and the local draft;
   Compare saved version and Use saved version resolved the conflict explicitly.
5. Renaming the source folder temporarily paused autosave. A local edit stayed in
   the browser, and restoring the same directory resumed revision-checked saving.
6. Deleting a dirty file externally preserved its draft across browser reload.
   Recreating the file with matching text cleared the conflict without extra edits.
7. Reload retained the folder association, active file and saved content.
8. The actual offline TeX Live runtime compiled the linked document; the PDF
   preview rendered nonblank pixels. The original folder contained only its source
   files afterward, with no compiler outputs or app metadata.
9. The narrow attachment dialog fit the viewport; the desktop writing workspace
   had no horizontal overflow.

Screenshots (local artifacts):

- Import: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muml7scm-d5022951.png`
- Narrow: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mumlai94-94a55d84.png`
- Compiled preview: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mumle1mg-bc225e8e.png`

A separate **read-only preview** of
`/home/hashim/thesis-workspace/thesis-latex` found 115 supported files, 11 folders,
59,179,803 bytes, and `main.tex`. It recognized Biber/glossary/font/script
requirements. This did not attach, compile or modify the real thesis.

## Regression Coverage

Store and HTTP tests use temporary real files for external edits, stale revisions,
permissions, assets, history/restore, generated-file exclusion, duplicate/retried
attachments, missing/replaced directories, symlinks, locality checks, source ZIP
export, Git exclusion and unavailable machine-local links. Editor tests cover polling versus
pending writes, dirty-file conflicts, deleted-file recovery and paused autosave.

Local `bun run typecheck`, `bun run test` (336 passed, two skipped) and
`bun run build` passed. The existing web bundle-size warning remains.
