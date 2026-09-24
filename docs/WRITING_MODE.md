# Writing Mode

Status: implementation started. Added 2026-09-23; updated 2026-09-24. The user
requested a Grammarly/Overleaf-like TeX workspace grounded in their code,
experiments and literature. These are product requirements, not claims of
competitor parity.
Existing notes, accepted research records, comparisons and synthesis-to-note
workflows are foundations; they are not yet a manuscript editor.

Current slice: global document CRUD and revision-checked `.tex`/`.bib` saves
are implemented, with automatic per-file history, named checkpoints and guarded
restore. The project Writing tab now includes a CodeMirror source editor, file
creation/deletion, autosave/recovery, side-by-side history review and source ZIP
export. Selected-text alternatives include explicit model/output-count controls,
an audience slider, context preview, saved batches, comparison and acceptance.
Compilation, bibliography insertion and evidence-grounded new prose remain open.
History is per-file, not yet a grouped multi-file document timeline.

The candidate API uses explicitly enabled AgenticDriver targets only, with an
explicit model and 1-3 outputs per target (at most 6 per batch). It supplies the
selected TeX text and up to 1,500 surrounding characters on each side, not any
unselected paper, repository or experiment. Responses are unverified editing
drafts. Partial failures retain successful alternatives; cancellation and process
restarts never automatically replay paid work. Acceptance pins the source
revision, records a recoverable intent, and writes a new text-history version.

## Product Goal

Write a thesis, paper or report alongside the work that supports it. Move from
research question to argument, outline, draft, cited revision and a reproducible
submission without losing the distinction between literature, original results
and interpretation. Manual writing and local compilation must work without an
agent or an application account. Adding this mode does not request app auth.

Writing is a global navigation tab with independent documents. A document can
link zero, one or several research projects, and the same project can support
several documents. These are references, not copied research data. Unlinking a
project never deletes text, history or candidates. Imported TeX documents remain
usable in an external editor and under Git.

Global document storage and APIs are implemented. Existing project-owned
manuscript folders migrate without changing document/history/candidate IDs;
legacy browser draft recovery keys are still recognized. Duplicate folder IDs
stop migration without overwriting either copy. Project-link changes use
optimistic concurrency, separately from text revisions. Linking a project alone
does not yet send its evidence to generation: source attachment remains W2 work.

## Workspace

- Left: manuscript file tree, section outline, labels/citekeys, assets and
  attachment inventory; collapse it without losing the active file/selection.
- Center: TeX source editor with syntax diagnostics, completion for citations,
  commands and labels, search/replace, undo/redo, autosave and crash recovery.
  TeX is canonical for TeX documents; no lossy rich-text round trip is required.
- Preview: compiled PDF with source-to-preview and preview-to-source navigation,
  zoom/page controls, build errors linked to file/line, and last successful build
  retained when the current source fails. Compilation is debounced/cancellable.
- Right inspector: Sources, Writing Assistant, Review and document checks.
  Commands can target selection, paragraph, section or whole manuscript, with
  the scope and selected provider/model visible before generation.
- Status: save/conflict state, current source revision, build status and section
  word budget. Split view, editor-only and preview-only are explicit modes;
  constrained screens show one main view without overlapping sidebars.
- Notes and Markdown drafts can feed a manuscript; creating a TeX version is an
  explicit export/import operation, never an invisible format conversion.

## Attach The Work

Each manuscript has an explicit context set, with section-level overrides:

- Papers, exact passages, annotations, notes and accepted comparison/extraction
  records from the literature workspace.
- Read-only code repositories or selected files: path, commit, line range and
  content hash; a dirty working-tree snapshot is clearly different from a commit.
- Experiment manifests, logs, CSV/JSON result tables, configuration files,
  figures, datasets and their documented provenance. Large datasets are linked
  by identifiers/manifests, not automatically copied into prompts.
- Read-only W&B projects/runs, metric histories and artifact tables, plus
  explicitly selected public codebases, benchmark protocols and result sources.
- Research questions, contributions, hypotheses, evaluation protocol and
  user-written findings. Unsupported notes remain assertions, not verified facts.

Attachment is not the only discovery path. The shared
[internal and external evidence finder](EVIDENCE_SOURCES.md) searches approved
repositories, experiment collections, W&B projects and literature for relevant
content. Users choose the allowed sources, not every supporting file or run in
advance. Search results become reviewable context for the active claim/section.

Users choose paths/files explicitly and inspect what will be sent to a provider.
Exclude credentials, environment files and ignored/binary/generated material by
default; also enforce secret detection and source-specific allowlists. Git ignore
rules alone are not a security boundary. Resolve symlinks safely and never read
outside an approved root. Attaching a repository does not execute its scripts,
notebooks or tests and does not grant an agent write access to it.

Pin source revisions used by a writing operation and record included/omitted
material. Changes mark dependent suggestions/claims stale, with a reviewable
refresh; never silently rewrite accepted prose. Missing sources and unavailable
context must be visible. Reading copies and indexes remain rebuildable.

Keep source types meaningful: literature supports external findings, code shows
implementation, results support measurements, and inference links premises.
Code alone cannot establish measured accuracy, runtime or a claimed improvement.
A user's experiment can support an original contribution without fabricating
a paper citation. These sources navigate to their own paper/page, file/commit
or result row, rather than pretending every reference has a PDF page.

## Planning And Storyline

- Generate editable outlines with section purpose, audience, word budget,
  planned claims, sources, figures and unresolved questions.
- Offer alternative argument structures: problem/gap/contribution/evaluation,
  thematic or chronological review, method comparison, and question-led reports.
  Explain structural differences without claiming a universal best structure.
- Storyline board: reorder argument blocks and connect claim, evidence, counter-
  evidence, limitation and transition. An outline reorder proposes file edits;
  it cannot silently rewrite the manuscript or break references.
- Reverse outline an existing draft to expose repetition, missing premises,
  unsupported conclusions and sections that do not answer the research question.
- Section briefs capture the intended takeaway and exclusions before drafting.
  Research-gap and novelty suggestions are explicitly limited to searched sources.

## Drafting And Revision

- Generate a sentence, paragraph, section or alternative versions from a selected
  outline block and approved context. Missing measurements get visible TODOs,
  never invented numbers, experiments, quotations or references.
- Expand, shorten, simplify, formalize, improve transitions, remove repetition,
  paraphrase, translate or convert notes into prose. Preserve technical symbols,
  citekeys, labels and meaning; support plain manual editing throughout.
- Grammar, spelling, punctuation, terminology and style suggestions are separate
  from factual/evidence checks. Accept/reject each suggestion, a selected group,
  or a full patch; retain originals and allow undo.
- Make stronger/weaker claims only with visible justification and evidence.
  Flag changes to negation, causality, population, units, numerical values and
  uncertainty. Fluent wording is not evidence of correctness.
- Keep instructions and chat per manuscript/section, version accepted outlines,
  and record provider/model, source revisions and generation settings on drafts.
- Personal style profiles use user-selected writing samples and terminology
  lists. They are optional, editable, and never an authorship/detection-evasion
  claim. A journal or supervisor style guide is a distinct selectable profile.

## Audience And Complexity Controls

Primary control: a labeled, keyboard-accessible slider from **Layperson** through
**Undergraduate**, **Graduate** and **Doctoral / specialist**. It sets target
assumed knowledge and explanation density, not research quality or truth.
Default to the manuscript's saved target; changing the slider alone never starts
generation or rewrites existing text. Show a before/after preview for a selection
and require acceptance.

Advanced independent controls prevent one ambiguous "make smarter" setting:

- Concision: concise to explanatory, with an optional word budget.
- Jargon: define on first use, minimize, or allow established domain terminology.
- Mathematical detail: conceptual description, key equations, or derivation.
- Formality, active/passive preference, spelling convention and target language.
- Audience familiarity with the specific field, distinct from academic level.

All levels preserve quantities, units, citations, limitations and uncertainty.
The system must not turn association into causation or omit a material caveat
to make prose simpler. Preferences may compete with the word budget; report
unmet constraints rather than silently removing evidence. Offer side-by-side
variants for the same paragraph and keep these settings local to their scope.

## Citation Finder And Evidence Review

- Select a claim and search Internal, Literature & public, or Both, within
  approved sources. Find relevant code, experiment/W&B results and paper passages
  rather than requiring pre-attached evidence. External discovery is explicit;
  show actual content availability and query/data egress before use.
- Trace original-work claims to code commits, run configs, metric/step or result
  cells; compare with paper/benchmark results only after checking their protocols.
  The shared evidence finder serves chat and notes too, not a second writing index.
- Rank and explain actual relevance, showing source passages and contrary or
  qualifying findings. Distinguish supports, contradicts, discusses and
  insufficient evidence. Similarity is not support or calibrated confidence.
- Verify that the passage supports the particular claim before proposing a
  citation. Offer a narrower supported wording when appropriate, or say that
  support was not found. Never attach a vaguely related reference to fill a gap.
- Insert valid TeX citation commands with stable citekeys and the project's
  chosen bibliography style. Detect missing/duplicate keys and preserve Zotero
  identity; updates use the shared bibliography model, not a second library.
- Own results use evidence links and figure/table/method references where
  appropriate; published software/datasets can have reviewed bibliography entries.
  Do not invent paper citations for code or measurements.
- Claim-to-evidence inspection shows which sentence a citation supports, exact
  quote, source type/revision and any inference. User edits or changed evidence
  invalidate earlier support checks instead of retaining a misleading badge.
- Source change/retraction notices flag affected passages when trustworthy
  signals exist; unavailable checks stay unknown. No licensed citation database
  or proprietary scite data access is assumed by this feature.

## Additional Writing Features

- Result-to-prose: insert values from approved result rows with units, sample
  counts, uncertainty and links back to their inputs. Preview formatting/rounding
  rules; never compare incompatible experiments without qualification.
- Figure/table workflow: attach assets, generate reviewable captions and alt
  text, link result provenance and keep labels/cross-references consistent.
- Manuscript consistency checks: abstract/conclusion versus body, acronym
  definitions, notation, dataset names, repeated claims, sample sizes, units and
  numbers across prose/tables/captions. Suggestions are not silent corrections.
- Reviewer/supervisor feedback inbox: anchor imported or manually entered
  comments to manuscript revisions, propose changes and draft a response letter
  referencing actual changes. This works locally without a collaboration service.
- Submission checklist: target structure, word limits, bibliography, broken
  labels, missing assets, outstanding TODOs, data/code availability and disclosure
  statements. Unknown facts stay unanswered; templates cannot certify compliance.
- Export a portable TeX project with bibliography/assets and compiled PDF, plus
  a provenance report. Markdown/DOCX export is later and must disclose loss of
  unsupported TeX formatting. Do not promise automatic Overleaf/cloud sync.
- Git-backed checkpoints and draft comparisons allow reverting an accepted
  change without deleting supporting notes or canonical research artifacts.
- Text history is independent of Git commits: automatic saved revisions, named
  versions, readable diffs and restoration that retains the replaced text.
  Start with per-file history; grouped manuscript checkpoints and authorship
  attribution are later extensions, not implied by individual saved versions.
- Multi-candidate drafting: explicitly choose model targets and output count per
  target (including repeated outputs from one model), compare proposed texts,
  and select one without discarding alternatives. Preserve prompt, source and
  manuscript revisions, provider/model and failure state for each candidate.
  Each acceptance is a conflict-checked edit recorded in text history. No model
  substitution, automatic winner or live inference is authorized by this plan.

## Implementation Boundaries

Use a proven editor, TeX parser/toolchain, bibliography formatter and PDF viewer;
evaluate exact dependencies against upstream documentation before selection.
Do not hand-roll TeX parsing or a compilation engine. Preserve existing PDF
annotations/readers and separate manuscript previews from source-paper viewers.

TeX compilation is an execution boundary, including imported templates. Use
restricted isolated compilation with no shell escape or network by default,
bounded filesystem access/resources and actionable package/build errors. Turning
off shell escape alone is not a complete sandbox. Package runtime/assets for
clean desktop installs; explicit opt-in package acquisition must not look like
an offline build. Do not introduce silent code execution while parsing evidence.

AgenticDriver remains the compute interface. LitAgent owns context permissions,
source anchors, manuscript revisions, reviewed edits and accepted outputs. This
plan does not authorize live provider calls or change the existing compute pause.
Existing provider/model selection and no-fallback behavior apply to every command.

Ownership: `apps/web` owns editor/review/preview UI; `apps/server` owns bounded
file/build APIs; `packages/library` owns manuscript/context/artifact persistence;
`packages/contracts` owns schemas; `packages/workflows` owns source-grounded
writing orchestration through the existing agent interface. Extend these modules
before inventing another storage system or provider runtime.

Tracked global document layout (assets/context/claims remain planned):

```text
manuscripts/{manuscriptId}/
  manuscript.json              # includes projectIds, no owning project
  main.tex
  sections/*.tex
  references.bib
  assets/
  outline.json
  context.json
  claims.json
  suggestions/{suggestionId}.json
  .history/{filePathHash}.json
  .history/blobs/{contentHash}.json
  .candidates/{batchId}.json
```

Local attachment-root mappings/credentials and compilation caches stay outside
tracked manuscript files; use logical source IDs and revision manifests for
portable provenance. External source contents require explicit snapshot/export
approval. Existing Git/LFS policy applies; exporting a project cannot silently
include private code, datasets, tokens or user-supplied test PDFs.

## Delivery Slices

| Slice | Scope | Gate |
| --- | --- | --- |
| W1: local writer | Global Writing tab, independent documents with reusable project links, multi-file TeX editor, recovery, restricted build, PDF preview, existing citation insertion | Documents import/edit/build/reopen without a project or AI provider; linked projects can be reused and unlinked without losing text/history; compile failures preserve source and last good preview. |
| W2: attach and find evidence | Library/notes/records plus searchable read-only code/result roots, permissions and revision manifests; reuse shared evidence discovery | Discover relevant files/rows without preselecting them; exact file/commit/row/passage navigation works; secrets/out-of-scope files never enter context; changed sources mark dependents stale. |
| W3: plan and draft | Outline/storyline, selected-text commands, audience slider, provider/model, reviewable patches | A synthetic source-grounded paragraph at each audience level preserves facts/cites/uncertainty; stale draft edits cannot overwrite new user text. |
| W4: citation review | Claim evidence inspector, internal/library evidence finder, unsupported/counterevidence, bibliography checks | Distinct claims select distinct supporting sources; code, measurements and literature retain different roles; unsupported claims remain flagged; no invented keys or silent citation substitutions. |
| W5: connected and advanced authoring | W&B/public code/benchmark and academic source adapters from E3/E4, result-to-prose, figures, consistency, reviewer response and submission presets | End-to-end examples retain inspectable provenance, comparison checks, valid exports and reversible edits; connectors are incremental and do not block local authoring. |

Start W1 after the notes/evidence foundation, alongside extraction work. W2-W4
reuse reliable source anchors; online search, graph views and cloud collaboration
are not prerequisites for local editing. Core writing MVP is W1-W4; advanced
features are incremental, not bundled into one large implementation.

## Acceptance Tests

- Import a synthetic multi-file TeX project, edit/build/restart, recover an unsaved
  draft, handle external file changes and reject stale suggestion application.
- Exercise compilation failure/cancellation, missing packages, denied shell/file
  access and excessive resource use without corrupting user files.
- Attach two code revisions and two result runs; distinguish implementation
  evidence from measured results and catch mismatched configurations/metrics.
- Discover evidence within approved local roots and synthetic W&B/public sources
  without pre-attached snippets. A cross-source claim retains exact run/metric,
  code and paper targets; incompatible benchmark protocols remain flagged.
- Generate outline/paragraph fixtures at each audience level; retain numbers,
  equations, negation, uncertainty and citation identity. Report omitted context.
- Reject invented/out-of-scope/stale sources and citation injection; verify local
  versus external-search consent and abstention when there is no support.
- Accept/reject/undo patches; manual edits during generation remain intact.
  Figure labels, bibliography and source/PDF navigation survive file reordering.
- Export and compile on a clean supported desktop runtime without the developer's
  global TeX install; disclose missing fonts/packages and offline limitations.
- Keyboard, selection, resize, text fitting and first-screen/interaction checks
  cover wide and constrained desktop layouts. Run typecheck and tests per slice;
  live-provider quality evaluation remains separate from deterministic fixtures.
