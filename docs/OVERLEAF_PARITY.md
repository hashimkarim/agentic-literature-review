# Overleaf-style writing roadmap

Requested and researched 2026-09-25. This is a parity backlog, not a claim that
the entire hosted Overleaf service has been implemented. Official starting
points: [feature overview](https://www.overleaf.com/about/features-overview) and
[documentation index](https://docs.overleaf.com/llms.txt). Maintain implementation
status and test evidence as features ship. No copied branding or plan limits.

Writing documents remain global, linked to multiple reusable projects. Sources,
review decisions, history and accepted artifacts remain application-owned.

## Review and collaboration

References: [comments](https://docs.overleaf.com/collaborating/commenting),
[tracked changes](https://docs.overleaf.com/collaborating/track-changes),
[reviewer modes](https://www.overleaf.com/learn/how-to/Reviewing_and_reviewers_on_Overleaf).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-01 | Anchored comments, replies, edit/delete, resolve/reopen | In progress: typed durable storage/API and revision checks; UI/browser acceptance next. |
| OL-02 | Review navigation/filtering | Implement with OL-01: current/all files, open/resolved/all, search, source highlights/jumps, stale-anchor reattachment. |
| OL-03 | Suggested replacements | Planned: persisted proposed text, visual diff, explicit accept/reject, revision-safe application and text history. |
| OL-04 | Continuous tracked changes | Planned: grouped insert/delete operations, individual/bulk decisions, overlapping edits and undo. Candidate acceptance is not general track changes. |
| OL-05 | Editing/reviewing/viewing modes | Planned editor behavior; actual role enforcement requires collaboration identity. Local UI mode is not access control. |
| OL-06 | Mentions, assignments, notifications | Planned after real collaborator identities; unread state, delivery and per-document preferences. |
| OL-07 | Live co-editing, cursors, collaborator chat | Planned with tested merge protocol, reconnect/resume, durable chat and no simulated participants. |

## Editing and navigation

References: [editor](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor),
[search](https://docs.overleaf.com/navigating-in-the-editor/searching-within-a-project),
[writing tools](https://docs.overleaf.com/writing-and-editing).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-08 | Source editor, highlight, undo/redo, find/replace | Existing CodeMirror; extend TeX completions, snippets, folding and context menu. |
| OL-09 | Visual/rich-text LaTeX editing | Planned parser-backed round trips; preserve unsupported commands verbatim. |
| OL-10 | Outline and cross-file navigation | Planned headings/labels/includes navigation respecting comments/verbatim and nested TeX. |
| OL-11 | Whole-document search/replace | Planned beyond per-file search; preview, grouped history and stale-file rejection. |
| OL-12 | Figure/table insertion tools | Assets/upload exist; add caption/label dialog, image paste, table grid/CSV paste and alignment. |
| OL-13 | Equation/symbol palette | Planned searchable symbols, templates and preview; source remains authoritative. |
| OL-14 | Word count and writing targets | Planned body/heading/caption/selection totals; label approximate versus TeX-aware counts. |
| OL-15 | Layout and editor preferences | Source/split/PDF, divider, panels/tabs persist. Add font/size, indent, wrap and spellcheck-language preferences. |
| OL-16 | Vim/Emacs and keyboard shortcuts | Planned maintained extensions with shortcut-conflict and accessibility checks. |
| OL-17 | Accessibility | Audit focus, review announcements, contrast, screen-reader labels and reduced motion. |

## History and recovery

Reference: [history/versioning](https://docs.overleaf.com/writing-and-editing/history-and-versioning).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-18 | Autosave, versions, file comparison/restore | Existing immutable snapshots, labels, visual diffs, restore, local recovery and conflict review beyond Git. |
| OL-19 | Whole-document timeline | Planned grouped edits, changed-file lists, any-two-version comparison, tree restore and historical ZIP. |
| OL-20 | Deleted-file recovery | History/trash retained; add browse/restore UI with collision handling. |
| OL-21 | Historical review state | Planned comment/track-change history alongside text. Current discussions survive text restores rather than rewinding. |
| OL-22 | Offline and multi-tab reconciliation | Draft recovery exists; add explicit offline queue, merge decisions and durable unsent review drafts. |

## Builds and PDF

References: [compiling](https://docs.overleaf.com/getting-started/recompiling-your-project),
[engine selection](https://docs.overleaf.com/getting-started/recompiling-your-project/selecting-a-tex-live-version-and-latex-compiler),
[PDF navigation](https://docs.overleaf.com/navigating-in-the-editor/working-with-the-pdf-viewer).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-23 | Compile/stop, diagnostics, last-good PDF | Existing offline Linux builds, revision snapshots, cancellation, logs and PDF download. |
| OL-24 | Compiler/runtime profiles | Basic and full TeX Live runtimes exist; expose supported choices and verify packaging on each OS. |
| OL-25 | Bibliography/glossary/font builds | Full-runtime support exists; preserve isolation and dependency diagnostics. |
| OL-26 | Auto-compile, fast/draft, clean rebuild | Planned debounced/coalesced jobs, safe cancellation, cache reset and resource limits. |
| OL-27 | Source/PDF sync | Planned forward/inverse SyncTeX tied to build hashes; reject stale navigation. |
| OL-28 | PDF navigation and workspace layouts | Viewer/zoom/split exist; fill gaps in thumbnails, outline/search, pop-out and per-document PDF preferences. |
| OL-29 | Generated files | Logs exist; add allowlisted auxiliary downloads, warning filters and safe navigation. |
| OL-30 | latexmkrc/custom builds/knitr | Imported scripts remain text. Execution needs reviewed sandbox profiles, resource/network policy and explicit opt-in. |

## Documents and publishing

References: [files](https://docs.overleaf.com/managing-projects-and-files/managing-projects-and-files),
[interchange](https://docs.overleaf.com/managing-projects-and-files/importing-and-exporting-files),
[templates](https://docs.overleaf.com/templates/creating-a-project-from-a-template).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-31 | Multi-file trees, folder/ZIP import, export | Existing folders, move/delete/upload, figures/fonts, main-file choice, Overleaf ZIP import and source ZIP export. |
| OL-32 | Document organization | Filters exist; add rename/duplicate/archive/trash, tags, pinning, sorting and recent activity. |
| OL-33 | Templates | Planned article/report/thesis/beamer starters and user templates; review licensing and retain bundled classes/assets. |
| OL-34 | Linked files and external URL imports | Planned explicit origin/revision snapshots, update previews and SSRF/size/type checks. |
| OL-35 | DOCX/Markdown/HTML interchange | Planned preview/loss report, isolated converters and original preservation. |
| OL-36 | Submission packages | Planned clean ZIP/PDF, missing references/assets and anonymization checks; publisher delivery needs a supported endpoint. |

## References, integrations and assistance

References: [citations](https://docs.overleaf.com/citing-and-references/adding-citations-and-references),
[integrations](https://docs.overleaf.com/integrations-and-add-ons/integrations-and-add-ons),
[AI assistant](https://docs.overleaf.com/integrations-and-add-ons/ai-features/ai-assistant).

| ID | Capability | Current status and acceptance target |
| --- | --- | --- |
| OL-37 | Citation/label completion and reference search | BibTeX/export and candidate reference insertion exist; add picker, metadata search and duplicate/undefined/unused checks. |
| OL-38 | Zotero/Mendeley/ReadCube | Local reference interchange exists; live connections need explicit account selection and conflict review. |
| OL-39 | Git/GitHub/Dropbox sync | Research-repo Git/LFS exists, not cloud co-editing; add document-aware sync and separately authorized connectors. |
| OL-40 | Language and structural assistance | Existing audience/style, outline/storyline/prose/review tasks and multi-model alternatives; add sentence-level grammar proposals/dictionaries. |
| OL-41 | LaTeX error explanations and AI tables | Planned through existing SDK; source-linked proposed fixes, no automatic build-script execution. |
| OL-42 | Evidence-based research writing | Continue literature/internal code/results/W&B/benchmarks, claim ledger and contradiction/coverage tools. |

## Hosted capabilities and boundaries

Sharing/invites, owner/editor/reviewer/viewer roles, ownership transfer, email
delivery, institutional SSO, organization management, hosted compile pools and
billing require separate deployment/access-control decisions. Broad feature
parity does not authorize an authentication migration, account access or paid
services. Keep local-first use independent of them. Subscription restrictions
and branding are not features to copy.
[Overleaf collaboration](https://docs.overleaf.com/collaborating/collaborating-in-overleaf)

## Delivery order

1. OL-01/02: comment review end-to-end; tests for reload, rename, conflicts,
   ambiguous/deleted anchors, source safety and desktop/mobile browser use.
2. OL-03/04: manual suggested edits then continuous tracking with safe history.
3. OL-10/11/14/37: outline, cross-file search, counts and references.
4. OL-19/20/21: whole-document history and review-aware restoration.
5. OL-24/26/27/28: build controls, auto-build and source/PDF navigation.
6. OL-09/12/13/15/16/32/33: authoring tools/preferences/document management.
7. Explicitly authorized hosted collaboration/connectors/deployment.

Small tested commits, real native T3 browser checks on disposable manuscripts,
no real paper/manuscript mutations during testing. Preserve authentication,
registry SDK pin, research boundaries and the AD-021 hold on new live Codex runs.
