# Internal And External Evidence Discovery

Status: planned, not implemented. Added 2026-09-24 from the user's requirement
to find evidence in their own code, experiments and W&B as well as papers,
public codebases and benchmarks. This extends [Writing Mode](WRITING_MODE.md)
and the shared chat/evidence workspace; it is not a writing-only attachment list.
No account access, live searches or connector implementation is claimed here.

## Product Goal

Ask a research question or select a draft claim, then discover supporting,
contradicting or qualifying evidence across approved sources. Users should not
have to know the relevant file, run or paper passage before asking. They choose
searchable repositories, experiment collections, remote projects and literature
sets; the finder locates the specific records within that scope.

Keep **Internal**, **Literature & public**, and **Both** as explicit search
scopes, with per-source toggles. Origin, visibility, hosting and evidence type
are separate: a private W&B run is internal work hosted remotely, and a paper
downloaded to the local library is still literature. Never equate local with
private, or remote with public.

## Source Families

| Family | Discoverable Content | Required Evidence Target |
| --- | --- | --- |
| Own codebases | Implementation, tests, configuration, dependency manifests, documentation and selected notebooks | Repository identity, commit or explicit dirty snapshot, file, symbol/line range and content hash |
| Local experiments | CSV/JSON tables, logs, run manifests, evaluation reports, figures and saved notebook outputs | Run/config identity, file revision, row/cell or log range, metric/unit, dataset/split and evaluation protocol when known |
| W&B | User-selected entity/projects, run configs, metric histories/summaries, tables and artifact contents | Run ID, exact metric key and step/window, aggregation, observed snapshot hash/time; artifact version/digest and table row where applicable |
| Literature | Selected library papers and explicitly enabled academic discovery sources | Canonical paper/version, actual full-text or abstract passage, page/section and extraction revision |
| Public repositories | Published implementations, tests, examples, releases and technical documentation | Repository URL, pinned commit/release, file/line or documentation section and retrieved revision |
| Benchmarks and datasets | Protocols, dataset/model cards, evaluation scripts, result tables and leaderboard entries | Versioned task/dataset/split, metric definition/unit, result row, protocol/config and retrieval snapshot/date |

Discover available metric/config/table fields before querying values; do not
assume a universal `accuracy` or `loss` key. A run title, artifact name, repository
README claim, search snippet or leaderboard rank is a discovery lead, not a
substitute for reading the underlying evidence. Structured data keeps its types,
units and missing values instead of being flattened into an untraceable summary.

## Shared Evidence Finder

1. Resolve the selected project/manuscript scope and allowed source families.
   Offer filters for repository/revision, experiment config, dataset/split,
   metric, paper collection and date. Never silently broaden a failed search.
2. Derive a reviewable search plan from the question or selected claim. Search
   code symbols/text, structured experiment fields and literature passages using
   source-appropriate adapters; do not force every source through PDF retrieval.
3. Retrieve bounded candidates, then inspect their actual contents and enough
   surrounding code, methods or evaluation context to interpret them. Show
   which sources were searched, filtered, unavailable, sampled or truncated.
4. Group candidates by claim and role: supports, contradicts, qualifies,
   discusses or insufficient evidence. Explain the link and retain premises
   for deductions. Similarity is neither factual support nor confidence.
5. Review the evidence and proposed wording. Save accepted links to the common
   evidence ledger for reuse in chat, notes, comparisons, outlines and writing.
   Reusing an accepted record still checks its current source/revision access.

The Sources inspector shows internal/external origin, evidence type, exact
excerpt or result cells, source revision, retrieval coverage and any limitations.
Clicking a code result opens that file revision and lines; a run result opens
the metric/table snapshot and its remote link; a paper opens its passage. A
missing old revision must be reported, never silently replaced by current data.

Example: **"Does our method outperform the published baseline, and why?"**

- Find the relevant own evaluation runs/configurations and corresponding code.
- Find the baseline's paper results, public implementation and benchmark protocol.
- Check comparability before calculating a difference. Cite the exact own and
  external result rows; code can explain an implementation difference, but does
  not establish why a performance change occurred.
- Propose a qualified paragraph or report that the evaluation settings differ.
  A causal explanation requires supporting experiments, not a plausible story.

## Claims, Comparisons And Citations

- Distinguish author-reported findings, our measured results, observed code
  behavior and inferred conclusions. Static code inspection cannot prove runtime
  behavior, measured performance or that an experiment used that revision.
- Link an own result to its recorded run/config, code commit, dataset and metric
  definition, then to the relevant external method/benchmark. Missing provenance
  remains unknown; a nearby commit or similarly named run is not a valid link.
- Check task, dataset version/split, preprocessing, metric definition/direction,
  aggregation, sample counts, seeds, uncertainty and relevant hardware/budget.
  Missing or incompatible fields prevent an unqualified numerical ranking.
  Show absolute versus relative differences and their recorded inputs/formula.
- Avoid cherry-picking: retain the run selection/filter, included/excluded runs
  and whether values are single-run, best-run or aggregated. A chart sample is
  not a certified full-history aggregate; describe its coverage.
- Keep citations typed. Literature and published software/datasets can have
  reviewed bibliography records; internal measurements instead link to evidence
  IDs, methods, figures, tables or appendices. Do not fabricate a paper DOI or
  force every reference into a `paperId`/PDF-page shape.
- Every generated claim cites its actual supporting records, including several
  source types when needed. Unsupported details remain flagged. Changes to a
  claim, source or comparison protocol invalidate the previous support review.

## Permissions, Revisions And Ownership

Connections are read-only and explicitly scoped to allowed local roots or
remote projects. Reuse existing credential facilities where appropriate and
keep secrets server-side/out of Git and provider context. This requirement does
not request application login, an auth migration or a new identity database.

Separate permission to read/index a source from permission to send its contents
to the selected model. An external search query can also leak private project
details: show/redact the query and obtain approval before sending such details
to an academic, repository or benchmark search service. Public-search permission
does not authorize uploading private source material. Imported content is data,
not trusted instructions; no repository code, notebook, evaluation or experiment
is executed by evidence discovery.

Preserve stable source IDs with immutable observed revisions and typed locations.
Remote summaries/URLs can change, so retain approved content snapshots or hashes,
observation time and extraction/query parameters. A run ID or branch name alone
is not an immutable revision. Check source access before retrieval and when
displaying saved evidence; revocation removes its searchable cached content and
prevents new disclosure, with retained audit metadata subject to retention policy.

Use rebuildable app-owned indexes and bounded connector caches, scoped by project
access. Extend the existing contracts/library/indexer/workflows/server boundaries;
keep legacy paper citations compatible while adding other source kinds. Search
metadata first, then retrieve relevant contents instead of downloading whole
repositories, datasets or run histories for every question. Report rate limits,
offline state and partial results without presenting failures as "no evidence".

AgenticDriver remains the only compute interface. LitAgent owns source adapters,
permissions, normalization, retrieval selection, validation and accepted records.
Do not add another agent harness or vector store just for Writing Mode. Evaluate
connector APIs/terms and exact library versions before implementation. Existing
compute-pause and no-live-provider boundaries remain unchanged.

## Delivery Slices

| Slice | Scope | Backlog / Acceptance Gate |
| --- | --- | --- |
| E1: shared source foundation | Typed source/revision/location records, permissions and navigation without breaking paper evidence | EVID-09; resolve paper, code and result fixtures with access and stale-revision guards. |
| E2: local evidence search | Discover relevant code and local results inside approved roots, combine with selected library papers | EVID-10/13; a user selects roots/collections, not individual evidence lines; each claim opens its own exact source. |
| E3: W&B evidence | Read-only selected-project connector, schema discovery, run/config/metric/table/artifact retrieval and bounded cache | EVID-11; fixture-backed permission, pagination, history/summary and revision tests; real account access requires separate explicit setup. |
| E4: external evidence | Academic discovery plus pinned public code and benchmark adapters, reviewed imports | EVID-12 and FIND source adapters; distinguish full content from metadata, preserve protocol/revision and do not leak private search context. |
| E5: cross-source review | Combined search, comparison checks, result-to-prose, gaps and counterevidence | EVID-13/14, WRITE-03/16; produce inspectable multi-source claims or a specific incompatibility/coverage warning. |

E1-E2 build on the gate 1 citation guards and gate 2 ledger, and supply Writing
Mode W2/W4 as well as chat. E3-E4 are incremental connectors, not prerequisites
for local editing/search. They are explicit roadmap commitments, not replaced by
manual file attachments. No live W&B account is required for offline use or
deterministic tests; connected acceptance is recorded separately.

## Acceptance Scenarios

- Find a code implementation and the relevant result rows without the user
  identifying their files beforehand; exclude a denied root and symlink escape.
- Resolve two same-named runs in different projects without cross-project access;
  distinguish metric summary, sampled history and an artifact table's version.
- Update a run summary, branch or benchmark page: saved evidence retains its
  original approved snapshot or reports unavailable/stale, not substituted data.
- Compare compatible synthetic runs against a synthetic published baseline;
  repeat with different splits, metric definitions and missing seeds/units.
  Unsupported comparisons cannot become unqualified superiority claims.
- Find both support and counterevidence across code, measurements and literature;
  label inference and retain every premise when drafting at any audience level.
- Simulate rate limits, pagination, offline connectors, partial histories,
  revoked access and context-budget omissions; report actual search coverage.
- Reject source prompt injection, secret-bearing files and unapproved private
  queries to external services; verify no experiment/code execution occurs.
- Navigate each source from chat and a manuscript, accept/reject proposed links,
  then export only approved contents with portable provenance and no credentials.
