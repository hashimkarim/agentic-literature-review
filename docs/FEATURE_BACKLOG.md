# LitAgent Feature Backlog

Updated: 2026-09-24. Delivery order: [roadmap](ROADMAP.md).
Research basis: [43-product feature survey](COMPETITIVE_RESEARCH.md).

This is a deduplicated product backlog, not a promise to copy every service or
an assertion that every listed feature is missing. Sources identify inspiration;
requirements and acceptance gates are proposed LitAgent design decisions. An API,
licensed corpus, or open-source license must be checked before integrating it.

## Reading This Backlog

- **P0:** make the existing reading/chat/evidence loop trustworthy and recoverable.
- **P1:** complete the local-first research workflow and desktop release.
- **P2:** advanced research, better automation, and optional integrations.
- **P3:** explicitly deferred expansion; not required for MVP.
- **MVP:** a working implementation exists; the next gate extends or hardens it.
- **Partial:** backend, prototype, or only part of the user workflow exists.
- **Planned:** no complete implementation identified in the current audit.
- **Later:** deliberately deferred. **Research:** evaluate feasibility first.
- **Not adopting:** inventoried competitor feature that conflicts with our goals.

Baseline status comes from the repository snapshot, existing tests, and targeted
code inspection, not a new end-to-end certification of every existing feature.
Every row has a stable ID. `C01` through `C43` refer to the numbered profiles in
the survey; `Core` refers to the original LitAgent requirements. Update statuses
and link implementation commits as work ships. Priorities are not deadlines.

## Non-Negotiable Requirements

- One global paper record, many project links; no project-specific PDF copies.
- Local files are canonical; SQLite/search indexes are rebuildable.
- Use TypeScript/TSX, existing package boundaries, and the current PDF renderer.
- Select provider/model per agentic task; no silent heuristic fallback.
- AI compute development is paused here: AgenticDriver owns execution, auth,
  model discovery, transport and provider lifecycle. Continue LitAgent domain/UI
  work against the existing interface and fixtures; see the [execution boundary](ROADMAP.md#current-execution-boundary).
- Agent outputs remain proposals until accepted. Missing data stays missing.
- Every research claim retains evidence or is explicitly marked unsupported;
  distinguish reported findings from inference and external knowledge.
- Local-first does not mean a selected cloud CLI provider runs offline. Show
  what leaves the machine, including excerpts, full text, figures, and logs.
- Never bypass access controls or bundle users' copyrighted test papers.
- App-owned, versioned annotation/evidence records must remain portable.
- Keep the global navigation and project-specific tools; no new top-level tab
  for every competitive feature. Preserve the existing theme/mock UI direction.

## Chat And Retrieval

Owners: `packages/workflows`, `packages/indexer`, `packages/contracts`,
`apps/server`, `apps/web`. Foundation for extraction, synthesis and writing.
Inspiration: [Anara](COMPETITIVE_RESEARCH.md#c02-anara),
[Consensus](COMPETITIVE_RESEARCH.md#c01-consensus),
[Asta](COMPETITIVE_RESEARCH.md#c11-ai2-asta),
[scite](COMPETITIVE_RESEARCH.md#c05-scite).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| CHAT-01 | Persistent conversational workspace: MVP | P0 | Reload, restart, paper switching and concurrent requests preserve thread, message order and source scope; add rename/archive/search without losing citations. | C02, C22 |
| CHAT-02 | Visible source sets: Partial | P0 | Select paper, selected papers, collection, project or global sources; show exact included documents and distinguish local, academic and web modes. | C09, C23, C35 |
| CHAT-03 | Full-Markdown paper context: MVP | P0 | Feed the complete converted paper when it fits; expose missing conversion, partial extraction and token-budget omissions instead of silently dropping later results. | C02, C11, Core |
| CHAT-04 | Large-library retrieval: Partial | P1 | Evaluate hierarchical section retrieval, lexical/optional vector search and reranking against a labeled baseline; balance multi-paper coverage and disclose unsearched material. | C11, C20 |
| CHAT-05 | Follow-ups and grounded inference: MVP | P0 | Tests cover pronouns, short follow-ups and multi-premise deductions; label inference, cite its premises, and distinguish unknown from negative evidence. | C01, C02, Core |
| CHAT-06 | Claim-specific citations and repair: MVP | P0 | Structured claim IDs, source review and one repair are implemented; measure actual support quality on representative material, retaining a distinct processing-failure state. | C05, C11 |
| CHAT-07 | Per-answer evidence navigation: MVP | P0 | Every citation selects its own source, including second/later references and another paper/page; no reused evidence stack from an earlier answer. | C02, C22 |
| CHAT-08 | Streaming, retry and steering: Partial | P1 | Stream visible stages, cancel cleanly, retry a failed turn, edit/resend and steer running research; preserve prior versions and prevent duplicate messages. | C02, C36, C37 |
| CHAT-09 | Reusable research context: Partial | P1 | Version project instructions, questions and user-approved thread summaries; include only scoped context and expose stale summaries after source changes. | C23, C35, C36 |
| CHAT-10 | Figure/table-aware Q&A: Planned | P2 | Retrieve images, captions and structured cells; cite a figure/table/page, report OCR uncertainty, and do not present visually inferred values as exact measurements. | C03, C20, C43 |
| CHAT-11 | Multilingual reading/chat: Planned | P2 | Preserve original quotes beside translated explanations; original-language citations still resolve and translation never overwrites the source. | C04, C22, C41 |
| CHAT-12 | Q&A quality benchmark: Partial | P0 | Add representative tests for methods, results, tables, inference, absent answers, scanned PDFs, scope leaks and prompt injection; report answer coverage and citation correctness per provider. | C11, C43, Core |

2026-09-21 checkpoint (`0a9764e`, `212c2a7`): CHAT-03/05/06 now have source manifests, explicit claim
citations, inference premises, bounded source review/repair and 27 dedicated
regressions. Source review uses the existing execution interface; it is not an
independent quality guarantee. CHAT-12 remains partial, and live-provider work is
paused. See [gate 1 progress](ROADMAP.md#1-trustworthy-research-chat) for validation
and remaining work.

## Document Reading And Annotations

Owners: `packages/pdf`, `packages/workflows`, `packages/library`, `apps/web`.
Depends on stable source identity and supports CHAT-07 and EVID-01.
Inspiration: [Semantic Reader](COMPETITIVE_RESEARCH.md#c17-semantic-scholar-and-semantic-reader),
[Anara](COMPETITIVE_RESEARCH.md#c02-anara),
[Scholarcy](COMPETITIVE_RESEARCH.md#c19-scholarcy).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| READ-01 | PDF navigation/selection/zoom: MVP | P0 | Real-document tests cover thumbnails/outline/search, zoom alignment, selecting text, cross-page jumps and a single copy of each page at desktop widths. | C02, C17 |
| READ-02 | Annotation tools and inspector: MVP | P0 | Text/area/shapes/drawings support color, opacity/outline, move/resize previews, comments, deletion and reload; default mode cannot accidentally create highlights. | C02, C09, Core |
| READ-03 | Annotation provenance and AI proposals: Partial | P1 | Record manual/agent origin, author/time/source version and optional project visibility; AI highlights require review and never overwrite manual annotations. | C02, C17, Core |
| READ-04 | Versioned citation anchors: Partial | P0 | Keep quote, page, Markdown range and best available geometry; after reconversion, resolve against the correct version or mark stale/orphaned rather than jumping to unrelated text. | C02, C31, Core |
| READ-05 | Marker-first conversion and targeted repair: MVP | P1 | Preserve originals, figures, equations and summaries; show extraction quality, permit section-level agent repair with a diff, and refresh open readers on completion. | Core |
| READ-06 | Parallel PDF/Markdown reading: Partial | P1 | Add synchronized split view with sensible independent scrolling, section links and visible uncertainty for approximate mappings. | C17, C25, Core |
| READ-07 | Citation previews and terminology: Planned | P2 | Hover/click a reference or selected term for a source card/definition, then return to the same reading position; distinguish generated definitions. | C17 |
| READ-08 | Study cards and skimming: Partial | P2 | Show reviewable findings/methods/limitations with adjustable keyword/criterion highlights; users can hide all generated overlays. | C19, C30 |
| READ-09 | Additional source formats: Planned | P2 | Add HTML/web snapshots, text/Markdown, DOCX and EPUB adapters with source dates/assets; audio/video later adds timestamp citations, not fabricated PDF pages. | C09, C22, C35, C40 |

## Global Library And Research Projects

Owners: `packages/library`, `packages/contracts`, `apps/server`, `apps/web`.
Inspiration: [Zotero](COMPETITIVE_RESEARCH.md#c38-zotero),
[ReadCube](COMPETITIVE_RESEARCH.md#c39-readcube),
[Logically](COMPETITIVE_RESEARCH.md#c09-logically-formerly-afforai).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| LIB-01 | Global identity and project membership: MVP | P1 | Importing through either of two projects creates one canonical paper with independent links, tags and decisions; unlinking cannot delete another project's source. | C07, C38, Core |
| LIB-02 | Rich deduplication and versions: Partial | P1 | Normalize DOI/arXiv/Zotero/hash identities; review uncertain merges and distinguish preprint, published article and supplementary files with reversible lineage. | C07, C24, C39 |
| LIB-03 | Metadata enrichment: MVP | P1 | Reconcile provider/import/catalog proposals at field level with provenance and conflict review; reject malformed IDs without losing existing metadata. | C09, C38 |
| LIB-04 | Collections, tags and saved filters: Partial | P1 | Nested collections, stars, custom fields and compound saved filters work consistently across library, search, graph and workflows. | C09, C39 |
| LIB-05 | Research question board and rubrics: Partial | P1 | Edit/version questions and inclusion/exclusion rules, assign papers/evidence, and optionally use domain templates such as PICO without imposing them on every field. | C03, C27, Core |
| LIB-06 | Batch intake and source acquisition: Partial | P1 | Recursive PDF inbox, uploads and identifier/reference imports report per-item outcomes, dedup decisions, linked projects and retryable failures. | C07, C24, Core |
| LIB-07 | Available full text and access provenance: Planned | P1 | Distinguish metadata/abstract/OA/user-uploaded full text; fetch permitted copies with origin/license where available and never bypass paywalls. | C06, C07, C26 |
| LIB-08 | Capture and personal library maintenance: Planned | P2 | Browser/share-sheet capture, attachment health and bulk metadata repair use previewable changes; recently added/unfiled views reflect real state. | C02, C38, C39 |

## Academic Discovery

Owners: normalized adapters in appropriate packages, orchestration in
`packages/workflows`, storage in `packages/library`, surfaces in `apps/web`.
Requires LIB-02/03/07 and scoped context; no assumed access to competitors' corpora.
Inspiration: [Undermind](COMPETITIVE_RESEARCH.md#c06-undermind),
[Asta](COMPETITIVE_RESEARCH.md#c11-ai2-asta),
[Consensus](COMPETITIVE_RESEARCH.md#c01-consensus).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| FIND-01 | Academic source adapters: Planned | P1 | Crossref/OpenAlex/arXiv/Semantic Scholar and later PubMed adapters return normalized records; test rate limits, pagination, provenance and API permissions independently. | C11, C17, C29 |
| FIND-02 | Natural-language and Boolean search: Partial | P1 | Add online discovery beside local FTS with date/type/author/venue/access/field filters; only show domain filters supported by a source. | C01, C18 |
| FIND-03 | Agent research plans: Planned | P1 | Clarify ambiguous requests, expose editable subquestions/queries/sources, run with time/request budgets and report stopping reasons and coverage limits. | C06, C11, C37 |
| FIND-04 | Forward/backward citation discovery: Planned | P1 | Expand multiple seeds through references and citations; deduplicate results and retain an actual discovery path for each candidate. | C13, C14, C18 |
| FIND-05 | Candidate relevance and import review: Partial | P1 | Explain fit to a question/rubric using available content; accept candidate metadata/full text explicitly and link without duplicating the global paper. | C03, C06, C07 |
| FIND-06 | Reproducible search history: Planned | P1 | Persist query syntax, adapter/version, filters, date, result IDs and counts; export history and replay as a new version, not an overwrite. | C03, C26, C27 |
| FIND-07 | Search from text, seeds or problem statements: Planned | P2 | A paragraph, selected claim or seed collection starts an inspectable discovery task; separate topic similarity from supporting a particular claim. | C10, C13, C33 |
| FIND-08 | Foundational/follow-on/bridge discovery: Planned | P2 | Distinguish prior works, derivative works and citation paths joining two papers; expose source and limitations of similarity rankings. | C15, C16 |
| FIND-09 | Conferences, authors and topic feeds: Planned | P2 | Save a monitor for selected venues/authors/subjects and turn new results into a deduplicated review inbox, not silent imports. | C12, C17 |
| FIND-10 | Specialist corpora and institutional access: Research | P3 | Evaluate patent/trial/guideline repositories and licensed holdings as opt-in adapters; document terms, jurisdiction and credentials before implementation. | C05, C18, C26, C41, C42 |

## Screening And Review Protocols

Owners: `packages/contracts`, `packages/library`, `packages/workflows`,
`apps/server`, `apps/web`. Depends on LIB-05 and FIND-06.
Inspiration: [Rayyan](COMPETITIVE_RESEARCH.md#c24-rayyan),
[Covidence](COMPETITIVE_RESEARCH.md#c25-covidence),
[ASReview](COMPETITIVE_RESEARCH.md#c28-asreview).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| REV-01 | Versioned review protocol: Planned | P1 | Define question, search strategy, screening/extraction fields and planned stages; record amendments and identify decisions made under older versions. | C03, C07, C27 |
| REV-02 | Title/abstract and full-text screening: Partial | P1 | Separate stages with include/exclude/maybe and controlled reason codes; preserve global paper identity and project-specific decisions. | C24, C25 |
| REV-03 | Evidence-backed criterion suggestions: Partial | P1 | Show each criterion's supporting quote and uncertainty; a model suggestion cannot silently become a final exclusion. | C03, C07, C25 |
| REV-04 | Efficient reviewer queue: Partial | P1 | Keyboard actions, filters, progress and undo operate on a stable queue; switching papers retains the decision context and exact source. | C24, C30 |
| REV-05 | Deduplication and PRISMA counts: Partial | P1 | Derive stage totals and exclusion breakdowns from events, including repeated imports and later reversals; export a reproducible diagram and source table. | C03, C07, C24 |
| REV-06 | Calibration and active learning: Research | P2 | Benchmark prioritization and stopping guidance on labeled samples with recall/uncertainty reports; no unreviewed auto-exclusion. | C25, C28 |
| REV-07 | Dual/blind review and conflicts: Later | P3 | Separate reviewer identities, independently stored decisions, blinding, adjudication and agreement statistics; require collaboration/auth foundations first. | C03, C07, C25, C27 |
| REV-08 | Work assignment and review subsets: Later | P3 | Assign batches/roles without exposing blinded decisions; audit reassignment and combine reviewer results without overwriting history. | C24, C26, C30 |
| REV-09 | Review methods and audit report: Planned | P1 | Generate a draft methods report from actual sources, dates, criteria, model use and decisions; unknown steps remain explicitly unreported. | C03, C24, C27 |

## Structured Extraction And Comparison

Owners: `packages/contracts`, `packages/workflows`, `packages/library`, `apps/web`.
Build on accepted research records, comparison artifacts and synthesis already
implemented; do not create a separate competing data model.
Inspiration: [Elicit](COMPETITIVE_RESEARCH.md#c03-elicit),
[DistillerSR](COMPETITIVE_RESEARCH.md#c26-distillersr),
[Nested Knowledge](COMPETITIVE_RESEARCH.md#c27-nested-knowledge).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| DATA-01 | Typed paper research records: MVP | P1 | Findings, methods, datasets, results, limitations and reproducibility records retain per-item review, evidence and provider/model provenance through edits. | C03, C19, Core |
| DATA-02 | Custom extraction schemas: Planned | P1 | Version configurable columns, types, units, allowed answers and field instructions; reject invalid cells and distinguish missing/not-applicable/conflicting values. | C03, C26, C30 |
| DATA-03 | Editable literature matrix: Partial | P1 | Show papers as rows and selected fields as columns; cite every generated cell, open its source, edit/accept/reject and export filtered views. | C04, C19, C39 |
| DATA-04 | Table/figure extraction: Planned | P2 | Preserve table structure, captions, units, page/region and extraction method; unsupported OCR values remain flagged for review. | C03, C20, C43 |
| DATA-05 | Quantitative outcomes and study arms: Planned | P2 | Represent population, condition, method, metric, units, sample size and uncertainty; don't compare numbers from incompatible protocols as equivalent. | C01, C27 |
| DATA-06 | Accepted-record comparisons and synthesis: MVP | P1 | Keep existing cited matrices/drafts; expose missing cells, conflicting findings and source versions, then regenerate with a reviewable diff. | C03, C20, C21 |
| DATA-07 | Reuse and batch extraction: Partial | P2 | Reuse accepted canonical fields across projects; keep question-specific interpretations separate, checkpoint batch work and rerun only invalidated fields. | C26, C39 |
| DATA-08 | Reproducibility and critical-appraisal forms: Partial | P2 | Version domain-appropriate checklists with per-item sources and human review; don't advertise a generic score as certified risk-of-bias assessment. | C19, C24, C25, Core |

## Evidence Ledger And Synthesis

Owners: `packages/contracts`, `packages/library`, `packages/indexer`,
`packages/workflows`, `apps/server`, `apps/web`.
Depends on CHAT-06, READ-04 and accepted DATA records.
The planned [internal/external evidence finder](EVIDENCE_SOURCES.md) extends
paper evidence to own code/results, W&B, public repositories and benchmarks.
It serves chat, notes, comparison and writing, with explicit source permissions;
attachments alone do not fulfill the discovery requirement.
Inspiration: [scite](COMPETITIVE_RESEARCH.md#c05-scite),
[Consensus](COMPETITIVE_RESEARCH.md#c01-consensus),
[EvidenceHunt](COMPETITIVE_RESEARCH.md#c42-evidencehunt).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| EVID-01 | Claim/evidence ledger: Partial | P1 | Browse claims with supporting passages, source version, inference status, confidence meaning, notes and research-question backlinks. | C01, C05, Core |
| EVID-02 | Citation-context stance: Planned | P2 | Separate supporting/contrasting/discussing citations with quoted context and provenance; a citing sentence is not proof of replication or quality. | C05 |
| EVID-03 | Contradiction finder: Planned | P2 | Compare accepted claims under compatible populations, settings and metrics; show both sources and require review of contradiction versus contextual difference. | C05, C21 |
| EVID-04 | Scoped consensus summaries: Planned | P2 | Group findings by stance with disclosed denominator, selection criteria and uncertain/mixed results; never imply a truth probability or whole-literature consensus. | C01 |
| EVID-05 | Gap maps and research directions: Planned | P2 | Show observed topic/method/dataset gaps and candidate questions linked to the searched corpus; absence from our search is not proof no study exists. | C01, C27, C42 |
| EVID-06 | Reference integrity checks: Planned | P1 | Validate bibliography identity, duplicated references and available correction/retraction/version signals with source dates; surface unavailable checks explicitly. | C05, C32 |
| EVID-07 | Evidence change propagation: Planned | P2 | Changed/retracted sources mark affected claims, notes, comparisons and answers stale; keep old snapshots and review regeneration diffs. | C26, C42 |
| EVID-08 | Statistical meta-analysis: Research | P3 | Only after validated quantitative schemas: use an established statistical engine, specify assumptions, assess heterogeneity and reproduce outputs with expert review. | C08, C27 |
| EVID-09 | Typed multi-source evidence: Planned | P1 | Extend paper evidence with code/run/result/benchmark source kinds, revisions and typed locations; preserve old citations and enforce source access on retrieval and saved display. | Core |
| EVID-10 | Own code and experiment discovery: Planned | P1 | Search approved repository/result roots without manually choosing every evidence file; retain commit/line or run/row/config provenance, exclude secrets and never execute source code. | Core |
| EVID-11 | Read-only W&B evidence connector: Planned | P1 | Discover fields and search selected projects/runs/configs/metrics/tables/artifacts; cite actual content with key/step/aggregation/snapshot, disclose sampling and handle permission, revision and offline failures. | Core |
| EVID-12 | Public code and benchmark discovery: Planned | P1 | Find and inspect pinned implementations, evaluation protocols and result rows alongside FIND paper adapters; distinguish metadata from inspected evidence and approve private query egress. | Core |
| EVID-13 | Unified internal/external evidence finder: Planned | P1 | Internal, Literature & public, and Both scopes share reviewed claim support/counterevidence with chat/notes/writing; report searched/omitted/unavailable sources and navigate every result's exact target. | Core |
| EVID-14 | Cross-source result comparability: Planned | P1 | Connect own runs/configs/commits to paper/benchmark results; check task, split, metric, aggregation and protocol, disclose run selection and qualify incompatible or incomplete comparisons. | Core |

## Notes And Source-Grounded Writing

Owners: `apps/web`, `packages/library`, `packages/workflows`, `packages/contracts`.
Backend note persistence and synthesis-to-note flows already exist; the general
notes workspace is not a finished editor.
The user-requested [Writing Mode](WRITING_MODE.md) is a global workspace with
independent documents and reusable many-to-many project links. The TeX editor,
history, selected-text alternatives and restricted Linux compilation/preview are implemented;
source-grounded new prose remains open. Existing note/synthesis features alone
are not a completed writing mode.
Inspiration: [Jenni](COMPETITIVE_RESEARCH.md#c31-jenni),
[Paperpal](COMPETITIVE_RESEARCH.md#c32-paperpal),
[Sourcely](COMPETITIVE_RESEARCH.md#c33-sourcely).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| WRITE-01 | Markdown notes workspace: Partial | P1 | Replace placeholder notes with browser/editor, autosave, search, revisions and recovery; support paper-linked and project-wide notes. | C21, C38, Core |
| WRITE-02 | Capture and backlinks: Partial | P1 | Save annotations, selected quotes, chat turns and workflow outputs as notes with durable backlinks to sources, runs and questions. | C02, C17, C35 |
| WRITE-03 | Citation finder and claim support: Planned | P1 | Reuse EVID-13 to discover internal and external support/counterevidence, inspect exact quotes/lines/result cells and revisions, abstain when unsupported and insert reviewed citations or internal evidence links; external search is explicit. | C05, C32, C33, Core |
| WRITE-04 | Outlines, storylines and drafts: Partial foundation | P1 | Extend accepted-comparison synthesis into section briefs, reorderable argument/evidence blocks, alternative storylines and reverse outlines; proposed edits preserve labels and require acceptance. | C03, C31, C37, Core |
| WRITE-05 | Bounded writing commands: Partial | P1 | Selected-text editing instructions, bounded context and reviewed alternatives implemented; evidence-grounded new prose, automatic semantic-change checks and fine-grained grammar suggestions remain open. | C23, C32, C34, Core |
| WRITE-06 | Optional source-grounded autocomplete: Planned | P2 | Suggestions use approved sources, can be disabled and never insert claims or citations before explicit acceptance. | C31, C34 |
| WRITE-07 | Figures, tables and cross-references: Planned | P2 | Insert permitted assets with captions, attribution and stable references; renumber outputs without breaking links to extracted evidence. | C34, C43 |
| WRITE-08 | Academic/submission checks: Research | P3 | Optional style/structure/reference checks report their limits; external similarity checking requires consent and licensed access. | C08, C32, C34 |
| WRITE-09 | Writing templates and output styles: Planned | P2 | Reusable annotated bibliography, research memo, comparison and review templates produce editable Markdown/LaTeX/DOCX outputs via PORT-04. | C12, C19, C31 |
| WRITE-10 | Global document writing workspace: Partial | P1 | Global documents/project links, folder/Overleaf ZIP import, hierarchical files/folders, upload/move/rename, main-file selection, asset previews, multi-file CodeMirror editing, autosave/recovery, conflict review and complete source ZIP export implemented. Prepared Linux XeLaTeX/Biber/glossary/font runtime builds a real imported thesis; citation/label completion, source/PDF navigation and cross-platform installers remain open. Manual authoring needs no project/provider/account. | Core |
| WRITE-11 | Restricted compilation and PDF preview: Working Linux MVP | P1 | Prepared offline XeLaTeX/Biber/BibTeX/makeindex/fonts and basic Tectonic runtimes, filesystem/network isolation, resource limits, revision-checked snapshots, build stages, cancellation, clickable errors, last-good PDF, split/preview layouts and PDF download implemented. Cross-platform sandbox/installers, release licensing review and bidirectional source navigation remain open. | Core |
| WRITE-12 | Searchable code and experiment context: Planned | P1 | Attach approved roots/collections or find relevant evidence via EVID-10/11/13; retain commit/hash/line/run/metric/row provenance, secret exclusions and context preview; never equate code with measurements or execute it. | Core |
| WRITE-13 | Audience/complexity slider: Partial | P1 | Four audience levels persisted with selected-text generation and explicit review; independent concision/jargon/math controls and real-provider semantic preservation evaluation remain open. | Core |
| WRITE-14 | Grammar, style and terminology review: Planned | P1 | Scoped accept/reject suggestions, glossary and editable style profiles; distinguish linguistic quality from evidence validity and preserve TeX commands. | Core |
| WRITE-15 | Revision-safe suggestions and provenance: Partial | P1 | Candidate batches preserve selected manuscript text/context/revision, models, failures and acceptance with history; stale edits are blocked. External evidence revisions and finer-grained patch review remain open. | Core |
| WRITE-16 | Results and manuscript consistency: Planned | P2 | Result-to-prose cites approved internal/W&B/external rows, units and uncertainty using EVID-14 comparisons; check abstract/body/conclusions, metrics, notation and figures; incompatible runs and missing facts remain flagged. | Core |
| WRITE-17 | Reviewer response workspace: Planned | P2 | Anchor local/imported feedback to manuscript revisions, track decisions and propose response letters citing actual edits; no hosted collaboration required. | Core |
| WRITE-18 | Text history beyond Git: Working per-file MVP | P1 | Automatic versions, named checkpoints, side-by-side diffs and conflict-checked restore preserve replaced text independently of Git; grouped manuscript checkpoints and authorship attribution remain open. | Core |
| WRITE-19 | Multi-model draft candidates: Working selected-text MVP | P1 | Explicit SDK models/counts, same-model variants, context preview, durable batches, comparison, cancellation, partial failure and revision-safe selection implemented with synthetic SDK tests; evidence-grounded new prose and live quality validation remain open. | Core |

Writing Mode's core scope is WRITE-03/04/05 and WRITE-10 through WRITE-15,
delivered as W1-W4 in the linked specification. WRITE-06/07/09/16/17 extend that
foundation. States above distinguish implemented slices from planned functionality.

## Concept Maps And Visual Discovery

Owners: `packages/library`, `apps/server`, `apps/web` using the existing graph
library. Requires real identifiers, DATA records and FIND citation edges.
Inspiration: [ResearchRabbit](COMPETITIVE_RESEARCH.md#c13-researchrabbit),
[Litmaps](COMPETITIVE_RESEARCH.md#c14-litmaps),
[Ponder](COMPETITIVE_RESEARCH.md#c40-ponder-formerly-researchflow).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| MAP-01 | Real project graph: Partial | P1 | Replace synthetic links with typed paper/author/tag/method/dataset/question/claim nodes and provenance-backed edges; label inferred similarity separately. | C13, C14, C40, Core |
| MAP-02 | Graph filters and linked selection: Partial | P1 | Filter by scope/year/tag/relevance/method; selecting a node updates papers/evidence and preserves workspace context. | C10, C14 |
| MAP-03 | Saved positions and export: Planned | P1 | Persist per-project layouts/pinned nodes; export graph data and an accessible visual snapshot with labels and legend. | C14, C40 |
| MAP-04 | Citation timeline and author networks: Planned | P2 | Show real citation direction, publication dates and author identity uncertainty; do not equate centrality with quality. | C13, C14, C17 |
| MAP-05 | Interactive neighborhood expansion: Planned | P2 | Expand seeds, bridge paths and prior/follow-on views into a preview set before importing; retain discovery provenance. | C13, C15, C16 |
| MAP-06 | Evidence/topic/qualitative maps: Planned | P2 | Aggregate reviewed records with disclosed counts; every region/node opens underlying studies and supports an accessible table alternative. | C27, C29 |
| MAP-07 | Map-to-outline workflow: Planned | P2 | Turn selected questions/claims into an editable outline with evidence links; graph placement alone cannot generate a factual relationship. | C35, C40 |

## Agent Workflows And Living Reviews

Owners: AgenticDriver for compute; existing `packages/agents` integration remains
in place. `packages/workflows` owns research orchestration, `apps/server`
scheduling and `apps/web` controls. New provider-runtime work is paused here.
PDF inbox event/timer/manual automation exists; a general workflow editor does not.
Inspiration: [Anara](COMPETITIVE_RESEARCH.md#c02-anara),
[Undermind](COMPETITIVE_RESEARCH.md#c06-undermind),
[DistillerSR](COMPETITIVE_RESEARCH.md#c26-distillersr).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| AUTO-01 | Provider/model selection and lifecycle: MVP; compute work paused | P1 | Preserve existing integration; consume the shared SDK's catalog/events/lifecycle when resumed. Keep application fixture tests for failures and cancellation; never silently use another provider. | Core |
| AUTO-02 | Manual recipes and typed outputs: Partial | P1 | Version/share project recipe definitions with scope, inputs, prompt/schema, provider/model, review gates and reproducible artifact metadata. | C04, C26, C42 |
| AUTO-03 | Event/scheduled workflows: Partial | P1 | Extend PDF inbox triggers to import/conversion/record changes and timed searches; deduplicate events and persist missed-run/retry policy across restarts. | C03, C26, Core |
| AUTO-04 | Visual workflow editor: Planned | P2 | n8n-style trigger/action/condition/review nodes validate connections and cycles; show dry-run input/output and serialize to tracked definitions. | Core |
| AUTO-05 | Resumable runs and approvals: Partial | P1 | Checkpoint steps, bound concurrency/time/token or cost budgets, expose queue scope and request tool permissions; resume without duplicate writes. | C02, C36, Core |
| AUTO-06 | Saved-search monitors and digests: Planned | P2 | Schedule FIND queries and create reviewable new/changed-paper sets and cited digests; pause, deduplicate and explain why each alert fired. | C03, C06, C12, C14 |
| AUTO-07 | Living evidence updates: Planned | P2 | Link alerts to affected question/claim/notes; show source and output diffs, retain history and review proposed downstream changes. | C26, C27, C42 |
| AUTO-08 | Alternative-viewpoint/verification agents: Research | P2 | Evaluate a bounded critic/verifier against a single-agent baseline for quality, latency and cost; separate provider agreement from independent evidence. | C11, C36, C37 |

## Reference Interchange And Version Control

Owners: `packages/library`, `packages/contracts`, `apps/server`, `apps/web`.
Required for useful local ownership, not gated on hosted accounts.
Inspiration: [Zotero](COMPETITIVE_RESEARCH.md#c38-zotero),
[SciSpace](COMPETITIVE_RESEARCH.md#c04-scispace),
[Jenni](COMPETITIVE_RESEARCH.md#c31-jenni).

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| PORT-01 | Bibliography import/export: Partial | P1 | Round-trip BibTeX/BibLaTeX/CSL JSON and add RIS/NBIB; preserve identifiers, Unicode names, citekey collisions and unmapped original fields. | C04, C29, C38 |
| PORT-02 | Zotero interchange: Partial | P1 | Import item keys, collections and attachment links; support watched exports/folders and conflict reports before any optional API/plugin write-back. | C01, C14, C38 |
| PORT-03 | Citation styles and bibliography: Partial | P1 | Use a proven CSL formatter; stable citekeys, selected-project/subcollection exports and in-text citations produce consistent bibliographies. | C09, C31, C38 |
| PORT-04 | Research artifact exports: Partial | P1 | Export notes, chats, evidence, matrices and review reports to Markdown/JSON/CSV plus suitable DOCX/LaTeX/HTML; preserve clickable provenance and assets. | C04, C31, C40 |
| PORT-05 | Portable annotations: Partial | P2 | Export/import app-owned annotation records and evaluate standard PDF/XFDF interoperability; original PDFs and editable records remain intact. | C02, C38, Core |
| PORT-06 | Git/LFS management UI: Partial | P1 | Show diffs/status/LFS health, intentionally stage and commit, then explicit fetch/pull/push; recover conflicts without silent overwrites or accidental PDF publication. | Core |
| PORT-07 | Backup, restore and history: Partial | P1 | Restore a repo on a fresh machine, rebuild indexes, migrate data and inspect/recover source revisions; credentials/caches stay untracked. | C26, Core |
| PORT-08 | External editors and integrations: Research | P3 | Evaluate Word/Google Docs/Overleaf/Obsidian/browser and cloud-folder connectors individually, with stable citekeys, permissions and explicit data-transfer consent. | C02, C09, C32, C38 |

## Runtime, Security And Delivery

Owners: all packages within their existing boundaries; packaging in
`apps/desktop`, local APIs in `apps/server`. Not competitor feature parity: these
are requirements for making the proposed workflows safe and usable.

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| OPS-01 | Fast reactive workspace: Partial | P0 | Separate provider probing from library loading; scoped events update Markdown/papers/jobs without reload, with measured load time and no stale cross-paper state. | Core |
| OPS-02 | Trust and execution boundaries: Partial | P0 | Treat papers/web text as untrusted input, validate paths/artifacts and local API access; tool actions require bounded scope and appropriate approval. | Core |
| OPS-03 | Fresh-install desktop runtime: Partial | P1 | Package backend/web/Marker dependencies; verify model download/offline behavior, first-run repo selection and actionable provider setup on each supported platform. | Core |
| OPS-04 | Resource and failure diagnostics: Partial | P1 | Surface conversion progress, missing dependencies, cancellation, disk/model requirements and recoverable failures; export redacted diagnostics without private content by default. | Core |
| OPS-05 | Accessibility and responsive workspace: Partial | P1 | Keyboard/focus/screen-reader checks cover chat, dialogs, source links and graph alternatives; no overlapping inspector tabs, unreadable themes or text overflow. | Core |
| OPS-06 | Reproducible validation and small releases: Partial | P1 | Typecheck, tests, public/generated PDF fixtures and core E2E gates run in CI; record commits by coherent feature and never track user test PDFs. | Core |
| OPS-07 | Typed API and optional MCP tools: Research | P2 | Expose bounded search/read/export tools with schemas, capability checks and audit logs; decide read/write permissions and third-party terms before installation. | C01, C05, C07 |
| OPS-08 | Measured observability: Partial | P2 | Record stage timing, retrieval/source coverage, provider/model and cost when available; redact sensitive data and never fabricate unavailable token/cost metrics. | C11, C36, Core |

## Deferred And Non-Core Options

Keep these visible so competitor research does not disappear, but do not expand
the local MVP to include them by default.

| ID | Feature / Current State | Priority | Next Acceptance Gate | Sources |
| --- | --- | --- | --- | --- |
| EXT-01 | Cloud sync and shared workspaces: Later | P3 | Design auth, permissions, encryption, conflict resolution and annotation/note record sync before hosting; local use remains independent. | C02, C09, C36, C38 |
| EXT-02 | Mobile companion and offline capture: Later | P3 | Read downloaded sources, scan/import pages, annotate and reconcile offline edits without changing canonical identity; retain source quality flags. | C02, C24, C35 |
| EXT-03 | Study/teaching outputs: Later | P3 | Optional flashcards, quizzes, slide decks and source-grounded study guides preserve citations and editable artifacts. | C19, C22, C35, C41 |
| EXT-04 | Audio/video overviews and read-aloud: Later | P3 | Provide transcripts with source anchors, accessibility controls and privacy/usage disclosures; generated summaries must not replace research evidence. | C22, C35 |
| EXT-05 | Enterprise governance: Later | P3 | Only with a deployment need: SSO, roles, shared libraries, audit export and retention controls backed by actual security testing. | C26, C39, C42 |
| EXT-06 | AI detectors and detection-evasion tools: Not adopting | - | Do not equate detector scores with authorship or research quality; do not add a humanizer marketed as evasion. Source-preserving editing remains WRITE-05. | C04, C08 |
| EXT-07 | Autonomous experiments/clinical decisions: Not adopting | - | Literature workflows may surface evidence, but wet-lab execution, molecule design and patient-specific recommendations are not LitAgent's product scope. | C42, C43 |

## Delivery Discipline

Before implementing a row, specify one small vertical slice, its owning modules,
dependencies, fixtures, failure behavior and UI acceptance checks. Reference its
ID in tests/commit messages where useful, and update this file plus the roadmap
after verification. Do not implement a feature merely because a vendor lists it.

Run `bun run typecheck` and `bun run test` before completion. UI changes also
require a running-app first-screen and interaction check. Use synthetic/public
fixtures in committed tests and privately supplied PDFs for optional local
regressions. Never commit those user PDFs, private chat logs or generated caches.

Revisit priorities after each delivery gate and refresh competitor sources
quarterly; retain the original evidence and decision when a planned feature is
deferred or rejected.
