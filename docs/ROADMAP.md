# LitAgent Roadmap And Progress

Updated: 2026-09-26

LitAgent is a local-first, project-centered literature review workspace. Papers
are canonical global records; projects reference them with their own screening
state, tags, collections, notes, questions, and generated research artifacts.

## Planning Documents

- [Overleaf-style writing parity](OVERLEAF_PARITY.md): feature inventory, current
  implementation gaps, anchored comments/review and ordered delivery criteria.
- [Writing Mode](WRITING_MODE.md): global TeX documents, linked projects, code/results and
  literature, storyline/drafting, citation finder and audience controls.
- [Internal/external evidence discovery](EVIDENCE_SOURCES.md): search own code,
  experiments and W&B alongside papers, public repositories and benchmarks;
  shared claim provenance, source permissions and comparison checks.
- [Authentication plan](AUTH_PLAN.md): Better Auth/AuthYard ownership, SDK pairing
  contracts, compatibility gates and application migration acceptance checks.
- [Competitive research](COMPETITIVE_RESEARCH.md): 43 products and adjacent tools,
  documented features, first-party sources, aliases and coverage limits.
- [Feature backlog](FEATURE_BACKLOG.md): deduplicated requirements with stable
  IDs, current state, priority, ownership, dependencies and acceptance gates.
- This document: current delivery snapshot, ordered milestones and release gates.

The competitive survey is a planning input, not a commitment to clone all these
products. Keep LitAgent's differentiators: local files, global paper identity,
project-specific research state, selectable CLI agents, reviewable outputs,
app-owned annotations and portable Git-backed evidence. Reliable chat and useful
research artifacts take precedence over broad feature counts.

## Current Execution Boundary

AI compute development is paused here while the user develops the shared
AgenticDriver SDK in `/mnt/shared/Git/agenticdriver` (T3 Code coordination thread
`e47d62d7-5263-410d-8983-1df4948e10d4`). Provider execution, authentication,
catalogs, sessions, streaming, cancellation, transport and usage belong there.
Keep the existing integration working; do not build a parallel runtime or start
new live-provider experiments. LitAgent work continues on domain data, chat
state/UI, retrieval, evidence validation, workflow checkpoints and approval UI,
using deterministic fixtures at the execution boundary. See [AGENTS.md](../AGENTS.md).

### Provider Consolidation

User requirement (2026-09-25): when AgenticDriver is fully working for LitAgent,
remove the legacy direct-provider integration. This removes duplicate execution
paths, not Codex/Claude/Gemini/etc. supplied by an AgenticDriver connection.

Removal is pending these application-level checks:

- A supported regular connection can execute, survives normal startup/reconnect,
  and keeps credentials server-side. A catalog-only connection or the separate
  synthetic-validation token does not satisfy this gate.
- Settings and task controls support connection setup, provider/model discovery
  and refresh, explicit selection, persisted enablement, and truthful offline
  errors without account/model fallback. Inventory remains separate from grants.
- Q&A, writing alternatives, refinement and research proposal workflows work
  through the existing SDK adapter, including progress, cancellation, failure
  recovery, run/usage traceability and unchanged evidence/acceptance safeguards.
  Use deterministic coverage plus necessary authorized synthetic-data acceptance;
  do not rerun completed live checks solely to create another receipt.
- Migrate project/recipe/default selections only where a matching connection is
  verified; otherwise require explicit reselection. Retain historical run,
  citation and artifact provenance. Drain active legacy work before removing its
  cancellation path. No deletion of the user's external CLI installations.
- Typecheck, tests, build, native T3 UI checks and Prometheus CI pass with legacy
  adapters absent. No legacy or heuristic fallback may conceal a driver outage.

Then remove the direct CLI adapters/discovery/login routes, duplicate provider
cards/selectors, obsolete settings and unused dependencies/tests/docs in small
verified commits. Keep read compatibility for historical records; do not rewrite
their provider identity. Reuse the SDK-owned management/pairing/component
contracts when released, rather than inventing a parallel management protocol.

## Delivery Snapshot

Driver connections (2026-09-26): multiple devices per LitAgent server, independent
app grants per driver, editable device labels, shared SDK provider settings,
host-scoped provider IDs, explicit app enablement/model defaults, and persisted
browser selection. Host setup stays on the driver; app preferences stay in
LitAgent. Regular Codex/Claude metadata refresh preserves saved choices. No
research prompts were sent. Automatic Usagestat provisioning, scoped usage UI,
verified remote device names and future-provider grant policy remain SDK work.
See [integration](agenticdriver.md#shared-panel-and-multiple-devices-2026-09-26)
and [acceptance evidence](validation/driver-panel-2026-09-26.md).

Workspace usability (2026-09-25): writing documents retain source/PDF mode,
split ratio, file tabs/folder expansion, assistant view and panel visibility in
versioned browser storage. The writing toolbar is consolidated and its file pane
collapsible. Library/project tool tabs, reader PDF/Markdown split mode, inspector
tabs, collapsed reading panes and Settings sections also persist. Validation:
typecheck, 201 unit/integration tests, production build, and native preview
reload/new-tab, comparison-return and responsive layout checks. No document
text, model credentials or pending generation requests are stored as preferences.

| Area | State | What Works Today | Main Gap |
| --- | --- | --- | --- |
| App foundation | Working | Bun/TypeScript monorepo, React web app, Electron shell, local server | Desktop packaging and update/install flow |
| Library and projects | Working | Global deduplicated papers, project links, collections, project-specific tags | Rich DOI/arXiv/Zotero metadata deduplication |
| PDF import and conversion | Working | Recursive PDF inbox, upload import, bundled Marker runtime path, assets, Markdown, passages, FTS refresh | Packaged-runtime validation on all desktop targets |
| PDF reader | Working | PDF.js highlighter, text/area/drawing annotations, colors/fill, persistence, citation jumps | Exact generated citation rectangles on more PDFs |
| Markdown reader | Working | GFM, figures/assets, KaTeX equations, tables, links, algorithm rendering | Editing and side-by-side PDF/Markdown mode |
| Search and cited Q&A | Working MVP | Scoped FTS, Markdown-context answers, persistent threads, explicit claim citations, bounded source review/repair and source-coverage diagnostics | Measured support quality, thread concurrency, versioned anchors and scalable project retrieval |
| Provider harness | AD-035 integration verified for selected Codex route | Refreshable shared-driver discovery/settings, explicit provider/model selection, offline recovery, normalized SDK run IDs/usage and cancellation; live cited Q&A and synthetic writing acceptance | Shared runtime work belongs to AgenticDriver; broader provider/package certification and Usagestat reconciliation remain separate. See [receipt](validation/ad-035-live-2026-09-25.md) |
| Agent workflows | Working MVP | Queue, provider/model selection, conversion, Q&A, reviewable relevance/metadata/research records, cited comparison matrices, and synthesis notes from accepted comparisons | Implement discovery, contradiction analysis and reusable recipes |
| Automatic workflows | Partial | PDF inbox rules with event, interval and manual execution | General recipe graph, durable scheduling, idempotent steps and living-search monitors |
| Discovery and screening | Partial | Local search, project relevance decisions and proposal review | Online discovery adapters, search histories, staged screening and auditable PRISMA counts |
| Structured extraction | Working MVP | Accepted findings/method/dataset/result/limitation/reproducibility records | Configurable extraction schemas, editable literature sheets and per-cell provenance UI |
| Notes | Backend foundation | Markdown note CRUD, annotation links and synthesis-to-note flow | General editor/browser, backlinks, evidence ledger and note search UI |
| Internal/external evidence finder | Planned | Paper evidence and accepted research records are foundations, not code/run connectors | Search own repositories/results/W&B and public code/benchmarks with typed provenance, source permissions and comparability checks |
| Writing Mode | Partial | Global linked documents, full folder/ZIP TeX editor, autosave/history/recovery, offline Linux builds/PDF preview; shared source/PDF comments with revision-bound SyncTeX navigation; visible assistant with outline/storyline/draft/edit/review commands, selected literature and code/result snapshots, exact context preview, multi-model alternatives, source validation, model support review, bibliography insertion and history-backed acceptance | Live W&B/repository/search connectors, automatic corpus retrieval, inline grammar patches, grouped history, general source/PDF navigation, cross-platform installers and live model quality |
| Concept map | UI prototype | Paper/tag graph surface | Real project graph API, filters, relationships and saved layouts |
| Bibliography and Zotero | Partial | Project BibTeX export and stored Zotero keys | BibLaTeX/CSL import/export and Zotero interchange/sync |
| Git and LFS | Foundation | Repository bootstrap, LFS policy and status display | Commit/sync UI, conflict handling and recovery guidance |

The core reading loop is usable: import a PDF, convert it, read/annotate it,
ask a provider-backed question, compare accepted records across papers, and jump
from supporting evidence to the source. The app is not feature-complete yet
because discovery, staged screening, contradiction review, and the general
notes workspace still need to consume the structured records. "Working MVP"
does not mean quality is proven across providers or every PDF: the next gate is
an end-to-end evaluation of the existing chat and evidence loop.

## Delivered Foundation

Record extraction, comparison artifacts, and synthesis-note workflows are
implemented. Preserve and extend these rather than treating them as new work.

- Evidence-backed relevance proposals can be edited, accepted, or rejected before
  changing project state.
- Metadata patch proposals support field-level evidence, edits, and partial acceptance.
- Findings, methods, datasets, results, limitations, and reproducibility details
  become typed, evidence-backed records only after per-item review.
- Cited comparison artifacts are built from accepted records and evidence.
- Synthesis artifacts are built from accepted comparison cells and evidence,
  with a review workspace and note creation.

## Ordered Delivery Gates

Order reflects the user's priorities and the competitive survey. Each gate
contains small independently tested commits; there are no calendar estimates.
Only rows explicitly included in the MVP definition are release blockers.
Accessibility, privacy, type safety, tests and packaging smoke checks accompany
every gate rather than being deferred to a final cleanup phase.

### 1. Trustworthy Research Chat

Priority: P0. Status: strengthen the existing MVP, not a rewrite.

Backlog: CHAT-01 through CHAT-07, CHAT-12, READ-01/02/04, OPS-01/02.

- Build a representative regression set for methods, results, numerical tables,
  short follow-ups, inference, missing answers and multiple evidence references.
- Show exactly which source versions were read; use full Markdown for a paper
  when possible and disclose missing conversion, extraction gaps and truncation.
- Validate that citations actually support their claims, not merely that a
  passage ID exists. Repair within a bounded budget or explain the failure.
- Verify that each answer has its own evidence and every citation jumps to its
  own paper/page/quote, including after zoom, page changes and reconversion.
- Preserve threads/scope and distinguish unsupported answers from provider or
  processing failures. Keep heuristic fallback disabled.

Exit: the benchmark reports answer quality, support coverage, citation accuracy
and failure reasons; all supported deterministic regression cases pass. Live
provider results are recorded separately from mocked tests, with limitations
visible rather than an unsupported "verified" badge.

First implementation slice: add the question-specific evidence and short
follow-up regressions with diagnostic traces, then fix the demonstrated failure
before expanding retrieval. Add optional vector search only after measuring the
FTS/full-document baseline.

Progress (2026-09-21):

- `0a9764e`: interactive Q&A no longer silently falls back to heuristics for an
  unknown provider, cancellation, failed or empty provider output. Missing
  conversion is reported as a prerequisite instead of "not found".
- `212c2a7`: new answers declare each claim's source IDs. Missing, stale, out-of-scope or
  truncated-away passages cannot be silently substituted. Inferences retain
  their premises; short answers and more than five citations are preserved.
- A source-review step checks support with the selected provider/model through
  the existing execution interface, with at most one draft repair. Failed
  processing remains an error, not a saved "not found" answer. This is model
  judgment, not independent verification or calibrated confidence.
- Answer details expose source hashes and included/total passage counts,
  including missing/placeholder/omitted documents. Passage-marker overhead
  counts toward the character budget; a source changed mid-answer requires retry.
  New evidence shows "Source linked" instead of an invented confidence percent.
- Verification: `bun run typecheck` and `bun run test` pass (78 tests, including
  27 dedicated Q&A regressions). Mocked cases cover follow-ups, distinct evidence,
  numerical/negation review failures, bounded repair, cancellation and source
  coverage. Browser checks cover first screen, diagnostics and evidence at
  1440px and 1920px with no page errors.
- Before the compute pause, a three-question synthetic Codex smoke test returned
  distinct method/result evidence and a labeled non-causal inference. No private
  papers were used. This is not a multi-provider quality benchmark.

- `7bf790c`: histories, drafts, pending sends and errors now belong to
  their paper/project/global scope. Late loads cannot replace another scope,
  duplicate sends are blocked, and opening another paper preserves context-wide
  chat. A failed history refresh retains an already saved answer and offers
  history reload rather than sending it again. Ten store regressions and the
  fixture-only `bun run test:chat-ui` browser check cover these transitions at
  1440px and 1920px. Typecheck and all 88 unit/integration tests pass.
- `c67546a`: the local backend rejects concurrent sends and
  archiving during an active answer. Persisted revisions protect sends and
  archive requests from stale browser tabs; the client reloads history while
  retaining the question for an explicit retry. Atomic thread replacement keeps
  old history intact on a failed write, with archives retained. Nine workflow
  regressions, two additional client checks and an isolated real-HTTP conflict
  test bring the suite to 100 passing tests. This assumes one local backend;
  distributed locking and network-retry idempotency remain separate work.
- `25fc217`: remove the first-five-passages fallback and its
  invented 75% score. New replies select their own evidence; manually selected
  older answers stay selected within their conversation across navigation.
  The panel names the question, has honest empty states, and supports keyboard
  citation activation. A current-paper coverage warning no longer represents
  global/project scope. Four more store tests and browser regressions cover
  distinct answers, both citation targets, scope switches and unsupported
  replies (104 tests plus 1440px/1920px browser checks).
- `765a0c2`: follow incoming replies only while pinned to the end.
  Restore positions across paper/context scope and inspector-tab switches;
  sending or the explicit latest-message control resumes following. Resize
  observation handles composer/content changes without timed forced scrolling.
  The browser regression now uses long fixture histories and an incoming reply
  while reading an older answer. Typecheck, all 104 tests and both desktop
  browser sizes pass; no live generation is used.
- Saved citation guards: new Q&A evidence records the exact supplied Markdown
  SHA-256. Citation resolution compares that revision and the saved quote before
  returning a target; reused IDs and changed/removed sources produce HTTP 409.
  Legacy evidence without a hash gets quote-identity checks, not a fabricated
  historical revision. The UI clears old highlights, shows failures and ignores
  out-of-order navigation responses. Typecheck, 108 tests and fixture browser
  checks at 1440px/1920px pass. Historical document retention and migration are
  still needed; this is identity validation, not proof of claim support.
- Legacy answer revision recovery: citation navigation now uses the cited
  paper's hash already saved in answer diagnostics when the evidence predates
  per-citation hashes. Conflicting or malformed saved revisions fail closed;
  no current document hash is substituted for a missing historical revision.
  Unit regressions cover paper isolation, missing hashes and conflicts; the
  browser fixture exercises diagnostic-only revisions through citation links.
  Typecheck, all 113 tests and 1440px/1920px browser checks pass.
- Citation geometry fallback: annotation rectangles are eligible only when the
  nonempty full quote matches the passage (whitespace normalized) on the same
  page. Unrelated shapes, partial quotes and off-page rectangles cannot supply
  citation highlights. Passage-owned rectangles retain precedence; without a
  trustworthy rectangle the viewer retains its quote/page fallback. Typecheck
  and all 117 tests pass, including four new repository regressions. This does
  not add historical PDF geometry or retained document versions.

Gate 1 remains open: next focus is historical source recovery and regression
coverage for reconverted documents. Legacy answer migration, durable
versioned anchors, representative PDF/table/injection evaluations and measured
cross-provider quality are not completed by this slice. Live compute work is
deferred under the execution boundary above.

### 2. Research Notes And Evidence Ledger

Priority: P1. Status: backend and synthesis-to-note foundation exists.
Backlog: WRITE-01/02, EVID-01, LIB-05; depends on gate 1 anchors.

- Replace the placeholder notes reader with a Markdown editor and note browser.
- Create notes from annotations, evidence, Q&A messages, and workflow outputs.
- Render backlinks to papers, passages, annotations, workflow runs, and research
  questions.
- Add an evidence ledger for claims, source passages, confidence, and note links.
- Carry source versions and accepted/generated status into notes and claims.

Follow-on evidence slices E1-E2 (EVID-09/10/13) generalize this foundation to
search approved code/result roots alongside library papers. The shared
[evidence-source plan](EVIDENCE_SOURCES.md) also commits to incremental read-only
W&B and public code/benchmark connectors (E3-E4, EVID-11/12), then cross-source
comparison checks (E5, EVID-14). These support chat and writing, not a separate
writing-only evidence store. Paper notes need not wait for every connector.

Exit: a user can turn a cited answer or annotation into an editable note, find
it later, follow all backlinks and reopen it after restart without losing data.

### 3. Editable Extraction And Comparison

Priority: P1. Status: typed records and comparison/synthesis MVP exists.
Backlog: DATA-01/02/03/06, LIB-03, WRITE-04.

- Add versioned custom extraction columns and a paper-by-field review sheet.
- Retain per-cell evidence, missing-data states, edits and partial acceptance.
- Extend existing comparison and synthesis views with source-version changes
  and explicit incomparability, not unsupported numerical rankings.

Exit: extract and review a multi-paper matrix, correct a cell, generate a cited
synthesis and save it to a note without re-entering accepted data.

### 4. Discovery And Screening

Priority: P1. Status: relevance decisions exist; online discovery is a gap.
Backlog: LIB-02/06/07, FIND-01 through FIND-06, REV-01 through REV-05, REV-09.

- Implement source adapters incrementally, with normalized records, rate-limit
  handling and provenance; do not depend on a proprietary competitor corpus.
- Add editable search plans, citation traversal, filters and replayable logs.
- Review discovery candidates before global import/project linking; preserve
  DOI/preprint/published-version identity and full-text availability.
- Add protocol versions, title/abstract and full-text stages, criterion-level
  suggestions, inclusion/exclusion reasons, undo and event-derived counts.
- Export search history, actual PRISMA-style counts and a draft methods report.

Exit: find, review, deduplicate, import and screen a candidate set, with every
count and decision traceable. No unreviewed automatic exclusions. Team/dual-blind
review and specialist active-learning models are not required at this gate.

### 5. Interchange And Version Control

Priority: P1. Status: partial.
Backlog: PORT-01 through PORT-04, PORT-06/07, EVID-06.

- Import/export BibTeX, BibLaTeX, CSL JSON and useful review interchange formats
  while preserving Zotero keys, citekeys, names and unmapped source fields.
- Add Zotero watched-folder compatibility before any direct write-back.
- Add Git diff, commit, pull/push, LFS health, and conflict recovery UI.
- Export notes, evidence ledgers, comparisons, and Q&A threads as tracked files.
- Validate reference identity and expose available correction/retraction signals.

Exit: round-trip a project bibliography and research artifacts, restore a repo
with rebuilt indexes, and intentionally commit/sync changes without silently
publishing local PDFs, credentials or generated caches.

### 6. Writing Mode And Concept Maps

Priority: P1 writing/core graph, P2 advanced authoring/exploration.
Status: editor/history, selected-text alternatives and restricted Linux compilation/preview implemented; cross-platform compiler packaging and evidence-grounded new prose open.
Backlog: WRITE-03/04/05, WRITE-10 through WRITE-15, MAP-01/02/03;
shared evidence: EVID-09 through EVID-14; then WRITE-06/07/09/16/17 and
MAP-04 through MAP-07.

Writing is a global workspace with independent documents linked to zero or more
reusable projects, specified in [Writing Mode](WRITING_MODE.md).
Start its W1 editor/preview foundation after gate 2, alongside gate 3; it does
not wait for online discovery, Zotero sync or concept-map completion. W2-W4
reuse gate 1 source guards and the notes/evidence foundation.

- Add a local multi-file TeX editor, restricted packaged compiler, PDF preview,
  citation/label completion, recovery and source-to-preview navigation.
- Attach selected read-only code, experiment/result records and literature with
  exact revisions, context permissions and meaningful source types.
- Find evidence within those sources without manually selecting every file/run.
  Add read-only W&B and public repository/benchmark adapters incrementally, with
  Internal, Literature & public, and Both scopes shared with research chat.
- Build outline/storyline and paragraph/section commands with reviewable diffs.
  Offer a layperson-to-doctoral/specialist slider with independent concision,
  terminology and mathematical detail; preserve facts, citations and uncertainty.
- Find citation support/counterevidence for individual claims, insert stable
  citekeys only after review, and leave unsupported claims explicitly unresolved.
- Link own results to run/config/commit and external baselines; check dataset,
  split, metric and evaluation protocol before proposing comparative claims.
  Internal evidence links are not fabricated literature references.
- Add grammar/style suggestions and revision-safe patch acceptance before
  advanced result-to-prose, consistency checks and reviewer response workflows.
- Build actual graph edges from citations, project membership, accepted records
  and research questions; distinguish citation from similarity and inference.
- Add filters, paper/evidence selection, accessible table views and saved layouts.
- Later add foundational/follow-on/bridge views, timelines and map-to-outline.

Writing exit: W1-W4 complete; edit/build/reopen a manuscript, attach approved
work, generate and review an outline/paragraph at a chosen audience level, trace
each claim to support or an explicit gap, and export a portable TeX project/PDF.
Graph exit: every displayed relationship has a defined meaning and source;
selecting a node opens the right paper/claim. Neither exit certifies agent quality
without its separate representative/live evaluations.

### 7. Reliable Automation And Living Research

Priority: P1 recipes/runtime; P2 visual editor and monitoring.
Status: PDF inbox event/timer/manual rules and workflow queue exist.
Backlog: AUTO-01/02/03/05; then AUTO-04/06/07, EVID-07.

- Version reusable project recipes with provider/model, typed inputs/outputs,
  permissions, budgets and human review steps.
- Persist checkpoints and deduplicate events; show queues scoped to the current
  paper/project while retaining a global overview in the appropriate workspace.
- Add an n8n-style editor after the underlying trigger/step model is reliable.
- Add saved-search monitors, cited digests and affected-claim notifications.

Exit: import triggers conversion, optional refinement and reviewable extraction;
restart/retry causes no duplicate artifacts. Scheduled discovery produces a
reviewable change set, never silently rewrites accepted research.

### 8. Clean Desktop Release

Priority: P1 release gate. Status: shell/runtime foundation exists.
Backlog: OPS-03 through OPS-06, READ-05/06, PORT-07.

- Package the local backend, Marker runtime, web assets, and Electron shell.
- Validate supported targets in clean environments, including model downloads,
  cached offline reading/conversion behavior and provider prerequisites.
- Add first-run repository selection, migrations, backup, recovery, diagnostics
  and an install/update path. Do not require a developer's global Python setup.
- Verify usable first screens, keyboard flows, loading/error states, and the
  complete research loop with public/generated fixtures and optional local PDFs.

Exit: a non-developer can install, set up a repository/provider, complete the MVP
loop and recover their data. Packaging checks begin before this gate, not here.

### 9. Advanced Evidence And Discovery

Priority: P2. Start only after the relevant foundations are measured.
Backlog: CHAT-04/10/11, DATA-04/05/07/08, EVID-02 through EVID-05,
FIND-07/08/09, REV-06, AUTO-08, OPS-07/08.

- Evaluate scalable hybrid retrieval, multilingual and figure/table questions.
- Add contextual contradiction review, citation stances, corpus-scoped consensus
  summaries, reproducibility/appraisal templates and evidence/gap maps.
- Evaluate active-learning screening and separate verification agents against
  simpler baselines; publish limits, cost and latency rather than accuracy claims.
- Add optional bounded MCP/API tools and more discovery adapters.

Exit per feature: measurable benefit on a defined evaluation set, editable
outputs and provenance, not merely similarity to a competitor's marketing page.

### 10. Optional Expansion

Priority: P3, no MVP dependency. See the backlog's deferred rows.

- Cloud/team sync, dual-blind review and reviewer assignments.
- Mobile/offline capture, source-grounded teaching/audio/video outputs.
- External editor/cloud connectors and licensed institutional/specialist corpora.
- Statistical meta-analysis only with validated data and an established engine.
- Enterprise controls only when there is a concrete supported deployment need.

Do not adopt AI-detector scores as truth, detection-evasion products, autonomous
wet-lab execution, molecule design or patient-specific clinical decision support.

## Definition Of MVP Complete

The local MVP is complete when a clean desktop install can:

1. Create a project and research question, then import/link the same paper across
   multiple projects without duplicating the canonical PDF.
2. Convert PDFs to readable Markdown with figures, equations, passages, and a
   rebuilt search index using the packaged runtime.
3. Read and annotate PDFs, write linked notes, and reopen both after restart.
4. Run relevance, metadata, findings, comparison, synthesis, and cited Q&A with
   a selected CLI provider/model and review structured outputs before applying
   canonical changes.
5. Jump every retained evidence reference to Markdown and the best available PDF
   page/selection, or clearly report that support was not found.
6. Review an editable multi-paper extraction/comparison and save its cited
   synthesis into a searchable notes/evidence workspace.
7. Discover candidate papers, approve import, screen against a versioned rubric
   and export traceable search/screening counts without silent AI exclusions.
8. Browse a real project concept map, filter it and return to linked evidence.
9. Export a project bibliography and tracked research artifacts, intentionally
   commit/sync them, then restore them with healthy Git/Git LFS state.
10. Run a reviewed automatic import/conversion recipe with selected providers,
    visible failures and restart-safe execution; no page reload is required to
    see changed Markdown, jobs or evidence.
11. Use core Writing Mode (W1-W4): edit/compile/recover a TeX manuscript, attach
    and search approved code/results/literature, review a source-grounded outline
    and draft at a chosen audience level, insert supported citations or internal
    evidence links and export sources/PDF.

Read-only W&B and public code/benchmark connectors are explicit incremental
deliverables (E3-E4), not prerequisites for local-only installation or editing.
Verify them with synthetic connector fixtures before separately authorized live
account checks; do not treat manual attachments as a completed connector.

Advanced visual automation, proprietary data integrations, vector retrieval,
meta-analysis, mobile, cloud/team features and multimedia outputs are not MVP
requirements. The explicit delivery gates, not competitor feature counts,
determine release readiness.

## Product Boundaries

- Hosted sync/team workflows are optional future work; local use must stand alone.
- No silent Zotero write-back, automatic canonical metadata changes or unattended
  exclusions based solely on a language model.
- No mandatory cloud indexes or hosted provider credentials. A selected remote
  provider is explicit and its data egress must be visible.
- Do not promise exact PDF rectangles when text geometry is unavailable; provide
  honest page/quote fallbacks and preserve source versions.
- Check API terms/content rights separately from competitive feature research.

## Progress Log

| Date | Change | Verification |
| --- | --- | --- |
| 2026-09-25 | Themed provider/model menus, focused TeX selection contrast and two-way compiled-PDF/source comments; corrected duplicate PDF highlight layers and retained bounded revision-bound SyncTeX maps | Typecheck, 253 tests (2 opt-in native skips), build, 17 targeted tests with the bundled compiler enabled, real isolated XeLaTeX build and native T3 desktop/mobile checks. Shared threads, reload, cross-file jumps, stale-build rejection, readable selections and zoom tested on synthetic data. [Evidence and limits](validation/writing-pdf-comments-2026-09-25.md). No model requests or real manuscript edits. |
| 2026-09-25 | Usability: readable TeX/PDF selections, contextual comments, explicit private AgenticDriver setup, source-folder preview and selectable recursive PDF/Zotero-storage imports | Typecheck, 236 tests (2 opt-in native compiler tests skipped), build and native T3 browser checks. Real connection discovery only in disposable data; zero generation requests. [Usability evidence](validation/writing-usability-2026-09-25.md). Dedicated [Prometheus CI](PROMETHEUS_CI.md) replaces hosted compute. Zotero metadata/cloud sync and live folder synchronization remain open. |
| 2026-09-25 | Overleaf feature inventory and local writing comments: anchored threads, replies, edit/delete, resolve/reopen, filters/search, source navigation/marks, explicit reattachment and new-comment draft recovery | Revision/permission/path/storage tests, actual HTTP API tests and native T3 browser checks on disposable data. [Review acceptance](validation/writing-comments-2026-09-25.md). Hosted collaboration and continuous track changes remain planned; no live generation or real manuscript edits. |
| 2026-09-24 | Visible writing assistant: selected literature/manuscript/code/result context, source revisions and coverage preview, outline/storyline/draft/edit/citation/review tasks, audience/style controls, multi-model alternatives, literal evidence validation, separate support review, bibliography insertion, rejection and history-backed acceptance | Typecheck, 194 tests (2 opt-in native compiler tests skipped), production build, assistant and existing writing/import browser suites at 1440/1920/860/390px pass. Installed SDK synthetic adapters only; no live accounts. Live connectors, automatic discovery and finer-grained grammar patches remain open. |
| 2026-09-24 | Complete document import and multi-file editor: bounded ZIP/folder inspection, atomic import, source/asset tree, file tabs, folders/upload/move/delete, main-file selection, history retention and full source export. Extended offline runtime adds XeLaTeX, Biber/BibTeX, glossary processing, bundled fonts and live build stages. | Typecheck, 184 tests including real compiler checks, production build, and import/build browser checks at 1440/1920/860/390px pass. A local 116-file, 52 MiB thesis compiled to 88 pages with original and imported source hashes preserved. No source/PDF test data committed or uploaded externally; no model calls. Original-folder live sync and cross-platform installers remain open. |
| 2026-09-24 | Offline Linux TeX build service and Writing preview: prepared pinned runtime, namespace isolation, revision snapshots, resource limits, cancellation, last-good PDF, layout controls, PDF download and guarded error navigation; fixed nested PDF teardown | Typecheck, 164 tests including real restricted compiler checks, production build, existing writing/chat regressions and real compilation browser checks at 1440/1920/860/390px. Canvas pixels, zoom, download, failed-build preservation, error selection, autosave, reload and cancellation verified. No live model calls; cross-platform packaging and source/PDF mapping remain open. |
| 2026-09-24 | Global Writing navigation replaces the project tab: independent document list, title/project filters, reusable project links, conflict review and unlinking without losing editor/history/candidates | Typecheck, 157 tests and build pass. Isolated real app/SDK browser workflows at 1440/1920/860/390px cover two documents sharing two projects, concurrent link edits, unlinking/reload and existing writing controls; chat checks at 1440/1920px and live local Writing/create-cancel smoke pass. Linked-project evidence ingestion remains planned; generation checks use synthetic models only. |
| 2026-09-24 | Global document storage/API, many-to-many project links and atomic migration from project folders; stable history/candidates and legacy browser recovery | Typecheck and 157 tests pass, including migration interruption/conflict, link concurrency, unlinking and candidate acceptance after migration. Global navigation UI follows. |
| 2026-09-24 | Candidate UI: explicit connections/models/output counts, audience slider, exact context preview, persistent alternatives, comparison and acceptance; narrow screens use inline diffs | Typecheck, 150 tests, build and existing chat checks; isolated app plus installed SDK synthetic HTTP checks at 1440/1920/860/390px cover repeated/multiple models, invalid output, cancellation acknowledgement, stale drafts, history and reload without replay. No real account calls or evidence-quality certification. |
| 2026-09-24 | Writing candidate backend: selected-text/model/count requests, bounded context, persisted alternatives, partial failures, cancellation, restart interruption and recoverable revision-checked acceptance | Typecheck and 150 tests, including HTTP candidate review and fixture execution; no live inference, provider runtime changes or automatic file acceptance. Candidate UI follows. |
| 2026-09-24 | Project Writing tab: CodeMirror editor, file management, autosave/recovery and conflict review; named text versions with visual diffs/restore and source ZIP export | Typecheck, 139 tests and build; real isolated HTTP/browser writing workflow at 1440/1920/860px, plus existing chat checks at 1440/1920px. No TeX compiler or live model calls. |
| 2026-09-24 | Writing foundation: project-owned TeX/BibTeX files, safe paths, atomic revision-checked saves, per-file automatic history, named checkpoints and restore APIs; added multi-candidate drafting requirement | Typecheck and 132 tests pass, including real HTTP CRUD/conflicts and history/integrity tests. Editor UI, compilation and generation are not completed by this slice. |
| 2026-09-24 | Added shared internal/external evidence discovery plan and EVID-09 through EVID-14: own code/results, W&B, papers, public repositories and benchmarks; linked chat/writing scopes and comparison checks | Planning only; documentation consistency checks. No connector, account access or live provider/search calls introduced. |
| 2026-09-23 | Added project Writing Mode specification, W1-W5 delivery slices and WRITE-10 through WRITE-17; expanded outline/citation/revision requirements and core MVP gate | Planning only; documentation consistency checks. No editor, compiler or agent workflow implemented by this change. |
| 2026-07-10 to 2026-07-11 | Accepted research records, cited comparison review and synthesis-to-note workflows implemented | Existing unit/integration coverage and prior feature commits |
| 2026-09-20 | Shared AgenticDriver SDK integration added alongside existing agent harness | Adapter tests; see [integration setup](agenticdriver.md) |
| 2026-09-21 | AD-042: migrated active app to exact registry `@agenticdriver/sdk@0.1.0`, scoped imports and Bun lockfile; removed sibling SDK dependency | Archive SHA-256/SHA-512 verified; typecheck, 117 tests, build and both desktop chat checks pass; independent frozen-lockfile install passes typecheck/tests/build. No real provider calls; AD-035 branch unchanged. See [provenance](agenticdriver.md#scoped-package-migration). |
| 2026-09-21 | Added first-party survey of 43 tools and prioritized feature backlog; corrected existing automation/notes status and reordered delivery around chat reliability | Documentation/link checks, `bun run typecheck`, `bun run test` (51 tests); no runtime behavior changed |
| 2026-09-21 | CHAT-06/OPS-04: removed interactive Q&A heuristic fallbacks and separated provider/conversion failures from research findings | `bun run typecheck`, `bun run test` (59 tests, including 8 new failure-boundary regressions) |

Keep this log and backlog current after each verified, locally committed feature.
